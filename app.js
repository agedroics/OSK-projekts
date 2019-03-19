"use strict";

var State = Object.freeze({
    NEW: "NEW",
    READY: "READY",
    RUNNING: "RUNNING",
    WAITING: "WAITING",
    TERMINATED: "TERMINATED"
});

var Flag = Object.freeze({
    ZF: 0x0040
});

var Register = Object.freeze({
    EAX: "eax",
    EBX: "ebx",
    EIP: "eip",
    FLAGS: "flags"
});

function Registers() {
    for (var register in Register) {
        this[Register[register]] = 0;
    }
}

function Process(pid, ppid, program) {
    this.pid = pid;
    this.ppid = ppid;
    this.program = program;
    this.state = State.NEW;
    this.registers = new Registers();
}

function Compare(l, r) {
    this.l = l;
    this.r = r;
}

Compare.prototype.execute = function(process) {
    var r = isNaN(this.r) ? process.registers[this.r] : parseInt(this.r);
    var result = process.registers[this.l] - r;
    if (result === 0) {
        process.registers[Register.FLAGS] |= Flag.ZF;
    } else {
        process.registers[Register.FLAGS] &= ~Flag.ZF;
    }
};

Compare.prototype.toString = function() {
    return "cmp " + this.l + ", " + this.r;
};

function Subtract(l, r) {
    this.l = l;
    this.r = r;
}

Subtract.prototype.execute = function(process) {
    var r = isNaN(this.r) ? process.registers[this.r] : parseInt(this.r);
    process.registers[this.l] -= r;
    if (process.registers[this.l] === 0) {
        process.registers[Register.FLAGS] |= Flag.ZF;
    } else {
        process.registers[Register.FLAGS] &= ~Flag.ZF;
    }
};

Subtract.prototype.toString = function() {
    return "sub " + this.l + ", " + this.r;
};

function Move(l, r) {
    this.l = l;
    this.r = r;
}

Move.prototype.execute = function(process) {
    process.registers[this.l] = isNaN(this.r) ? process.registers[this.r] : parseInt(this.r);
};

Move.prototype.toString = function() {
    return "mov " + this.l + ", " + this.r;
};

function Jump(eip, label) {
    this.eip = eip;
    this.label = label;
}

Jump.prototype.execute = function(process) {
    process.registers[Register.EIP] = this.eip;
};

Jump.prototype.toString = function() {
    return "jmp " + this.label;
};

function JumpIfEqual(eip, label) {
    this.eip = eip;
    this.label = label;
}

JumpIfEqual.prototype.execute = function(process) {
    if ((process.registers[Register.FLAGS] & Flag.ZF) !== 0) {
        process.registers[Register.EIP] = this.eip;
    }
};

JumpIfEqual.prototype.toString = function() {
    return "je " + this.label;
};

function JumpIfNotEqual(eip, label) {
    this.eip = eip;
    this.label = label;
}

JumpIfNotEqual.prototype.execute = function(process) {
    if ((process.registers[Register.FLAGS] & Flag.ZF) === 0) {
        process.registers[Register.EIP] = this.eip;
    }
};

JumpIfNotEqual.prototype.toString = function() {
    return "jne " + this.label;
};

function Call(closure, identifier) {
    this.closure = closure;
    this.identifier = identifier;
}

Call.prototype.execute = function(process) {
    this.closure(process.pid);
};

Call.prototype.toString = function() {
    return "call " + this.identifier;
};

function Computer() {
    this.pidCounter = 2;
    this.cpus = {};
    this.queue = [];

    this.programs = {
        "init": this.compile("mov ebx, -1\nbegin:\ncall wait\njmp begin")
    };

    var initProcess = new Process(1, 0, this.programs.init);
    this.processes = {1: initProcess};
}

Computer.prototype.reap = function(pid) {
    var process = this.processes[pid];
    for (var childPid in this.processes) {
        if (this.processes[childPid].ppid === process.pid) {
            this.processes[childPid].ppid = 1;
        }
    }
    delete this.processes[pid];
};

Computer.prototype.doWait = function(pid) {
    var process = this.processes[pid];
    for (var cpu in this.cpus) {
        if (this.cpus[cpu] && this.cpus[cpu].pid === pid) {
            this.cpus[cpu] = null;
            Vue.set(process, "inCpu", false);
            break;
        }
    }
    process.state = State.WAITING;
};

Computer.prototype.fork = function(pid) {
    var originalProcess = this.processes[pid];
    var forkedProcess = new Process(this.pidCounter++, pid, originalProcess.program);
    originalProcess.registers[Register.EAX] = forkedProcess.pid;
    forkedProcess.registers = JSON.parse(JSON.stringify(originalProcess.registers));
    forkedProcess.registers[Register.EAX] = 0;
    Vue.set(forkedProcess, "inCpu", false);
    this.processes[forkedProcess.pid] = forkedProcess;
};

Computer.prototype.wait = function(pid) {
    var process = this.processes[pid];
    var arg = process.registers[Register.EBX];
    var children;
    var self = this;
    if (arg === -1) {
        children = Object.keys(this.processes).filter(function(pid) {
            return self.processes[pid].ppid === process.pid;
        });
    } else if (this.processes.hasOwnProperty(arg) && this.processes[arg].ppid === process.pid) {
        children = [arg];
    } else {
        children = [];
    }
    if (children.length === 0) {
        process.registers[Register.EAX] = -1;
    } else {
        for (var i in children) {
            var child = this.processes[children[i]];
            if (child.state === State.TERMINATED) {
                process.registers[Register.EAX] = child.pid;
                this.reap(child.pid);
                return;
            }
        }
        var onTerminated = function(pid) {
            children.forEach(function(child) {
                delete child.onTerminated;
            });
            if (process.state === State.WAITING) {
                process.registers[Register.EAX] = pid;
                self.reap(pid);
                process.state = State.READY;
                self.queue.splice(0, 0, process);
                Vue.set(process, "inQueue", true);
            }
        };
        children.forEach(function(pid) {
            self.processes[pid].onTerminated = function() {
                onTerminated(pid);
            }
        });
        this.doWait(pid);
    }
};

Computer.prototype.yield = function(pid) {
    if (this.queue.length !== 0) {
        var process = this.processes[pid];
        for (var cpu in this.cpus) {
            if (this.cpus[cpu] && this.cpus[cpu].pid === pid) {
                this.cpus[cpu] = null;
                Vue.set(process, "inCpu", false);
                this.queue.push(process);
                Vue.set(process, "inQueue", true);
                break;
            }
        }
    }
};

Computer.prototype.kill = function(pid, targetPid) {
    var process;
    if (pid) {
        process = this.processes[pid];
    } else {
        process = new Process(0, 0, []);
    }
    if (typeof targetPid === "undefined") {
        targetPid = process.registers[Register.EBX];
    }
    if (!this.processes.hasOwnProperty(targetPid)) {
        process.registers[Register.EAX] = -1;
    } else {
        var target = this.processes[targetPid];
        target.state = State.TERMINATED;
        if (target.inQueue) {
            this.queue.splice(this.queue.indexOf(target), 1);
            Vue.set(target, "inQueue", false);
        }
        if (target.inCpu) {
            for (var cpu in this.cpus) {
                if (this.cpus[cpu] && this.cpus[cpu].pid === target.pid) {
                    this.cpus[cpu] = null;
                    Vue.set(target, "inCpu", false);
                    break;
                }
            }
        }
        if (target.onTerminated) {
            target.onTerminated();
        }
        process.registers[Register.EAX] = 0;
    }
};

Computer.prototype.doCycle = function() {
    var process;
    for (var pid in this.processes) {
        process = this.processes[pid];
        if (!process.inQueue && !process.inCpu && [State.READY, State.NEW].indexOf(process.state) !== -1) {
            this.queue.push(process);
            Vue.set(process, "inQueue", true);
        }
    }

    for (var cpu in this.cpus) {
        process = this.cpus[cpu];
        if (process) {
            if (process.state === State.NEW) {
                process.state = State.RUNNING;
            } else if (process.registers[Register.EIP] >= process.program.length || process.registers[Register.EIP] < 0) {
                process.state = State.TERMINATED;
                this.cpus[cpu] = null;
                Vue.set(process, "inCpu", false);
                if (process.onTerminated) {
                    process.onTerminated();
                }
            } else {
                process.program[process.registers[Register.EIP]++].execute(process);
            }
        }
        if (!this.cpus[cpu] && this.queue.length > 0) {
            process = this.queue.splice(0, 1)[0];
            Vue.set(process, "inQueue", false);
            this.cpus[cpu] = process;
            Vue.set(process, "inCpu", true);
            if (process.state === State.READY) {
                process.state = State.RUNNING;
            }
        }
    }
};

function isRegister(string) {
    for (var register in Register) {
        if (string.toLowerCase() === Register[register]) {
            return true;
        }
    }
    return false;
}

Computer.prototype.compile = function(code) {
    var lines = code.split("\n");
    var label;
    var labels = {};
    var program = [];
    var i;
    for (i in lines) {
        var found;
        var constructor;
        if ((found = lines[i].match(/^\s*([a-z_]\w*):\s*$/i))) {
            label = found[1].toLowerCase();
            if (labels.hasOwnProperty(label)) {
                return i;
            } else {
                labels[label] = program.length;
            }
        } else if ((found = lines[i].match(/^\s*(cmp|sub|mov)\s+([a-z]+),\s*([a-z]+|-?\d+)\s*$/i))) {
            switch (found[1].toLowerCase()) {
                case "cmp":
                    constructor = Compare;
                    break;
                case "sub":
                    constructor = Subtract;
                    break;
                case "mov":
                    constructor = Move;
            }
            if (isRegister(found[2]) && (!isNaN(found[3]) || isRegister(found[3]))) {
                program.push(new constructor(found[2].toLowerCase(), found[3].toLowerCase()));
            } else {
                return i;
            }
        } else if ((found = lines[i].match(/^\s*(jmp|je|jne)\s+([a-z_]\w*)\s*$/i))) {
            switch (found[1].toLowerCase()) {
                case "jmp":
                    constructor = Jump;
                    break;
                case "je":
                    constructor = JumpIfEqual;
                    break;
                case "jne":
                    constructor = JumpIfNotEqual;
            }
            program.push(new constructor(null, found[2]));
        } else if ((found = lines[i].match(/^\s*[cC][aA][lL][lL]\s+(fork|wait|yield|kill)\s*$/))) {
            program.push(new Call(
                (function(self, identifier) {
                    return function(pid) {self[identifier](pid);}
                })(this, found[1]),
                found[1]
            ));
        } else if (!/^\s*$/.test(lines[i])) {
            return i;
        }
    }
    for (i in program) {
        if ([Jump, JumpIfEqual, JumpIfNotEqual].indexOf(program[i].constructor) !== -1) {
            label = program[i].label.toLowerCase();
            if (labels.hasOwnProperty(label)) {
                program[i].eip = labels[label];
            } else {
                return i;
            }
        }
    }
    return program;
};

function decompile(program) {
    var code = [];
    var labels = [];
    for (var i in program) {
        code.push(program[i].toString());
        if ([Jump, JumpIfEqual, JumpIfNotEqual].indexOf(program[i].constructor) !== -1) {
            labels[program[i].eip] = program[i].label;
        }
    }
    for (i = labels.length - 1; i >= 0; --i) {
        if (labels[i]) {
            code.splice(i, 0, labels[i] + ":");
        }
    }
    return code.join("\n");
}

new Vue({
    el: "#app",
    data: {
        computer: new Computer(),
        selected: "init",
        name: "",
        code: "",
        errors: {},
        delay: 1000,
        timerId: null
    },
    methods: {
        getFlags: function(process) {
            return (process.registers[Register.FLAGS] & Flag.ZF) === 0 ? "NZ" : "ZR";
        },
        getInstruction: function(process) {
            return process.registers[Register.EIP] >= process.program.length ? "-" :
                process.program[process.registers[Register.EIP]].toString();
        },
        createProcess: function() {
            var process = new Process(this.computer.pidCounter++, 1, this.computer.programs[this.selected]);
            Vue.set(this.computer.processes, process.pid, process);
        },
        openNew: function() {
            this.name = "";
            this.code = "";
            this.errors = {};
        },
        openEdit: function() {
            this.name = this.selected;
            this.code = decompile(this.computer.programs[this.selected]);
            this.errors = {};
        },
        deleteProgram: function() {
            Vue.delete(this.computer.programs, this.selected);
            this.selected = Object.keys(this.computer.programs).length === 0 ? null : Object.keys(this.computer.programs)[0];
        },
        save: function() {
            this.errors = {};
            if (!this.name || !this.name.trim()) {
                Vue.set(this.errors, "name", "Please provide a name");
            }
            var result = this.computer.compile(this.code);
            if (!Array.isArray(result)) {
                Vue.set(this.errors, "code", "Error on line " + (parseInt(result) + 1));
            } else if (!this.errors.name) {
                Vue.set(this.computer.programs, this.name.trim(), result);
                this.selected = this.name;
                $("#editor-modal").modal("hide");
            }
        },
        addCpu: function() {
            Vue.set(this.computer.cpus, Object.keys(this.computer.cpus).length, null);
        },
        removeCpu: function() {
            var cpu = Object.keys(this.computer.cpus).length - 1;
            var process = this.computer.cpus[cpu];
            Vue.delete(this.computer.cpus, cpu);
            if (process) {
                Vue.set(process, "inCpu", false);
                this.computer.queue.push(process);
                Vue.set(process, "inQueue", true);
            }
        },
        changeSpeed: function(event) {
            var speed = parseInt(event.target.value);
            if (this.timerId !== null) {
                clearTimeout(this.timerId);
                this.timerId = null;
            }
            if (speed) {
                this.delay = 2000 / speed;
                var self = this;
                this.timerId = setTimeout(function() {
                    self.doCycle();
                }, this.delay);
            }
        },
        doCycle: function() {
            this.computer.doCycle();
            var self = this;
            this.timerId = setTimeout(function() {
                self.doCycle();
            }, this.delay);
        }
    }
});