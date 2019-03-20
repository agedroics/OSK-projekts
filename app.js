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
    ECX: "ecx",
    EDX: "edx",
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
    ++process.registers[Register.EIP];
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
    ++process.registers[Register.EIP];
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
    ++process.registers[Register.EIP];
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
    } else {
        ++process.registers[Register.EIP];
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
    } else {
        ++process.registers[Register.EIP];
    }
};

JumpIfNotEqual.prototype.toString = function() {
    return "jne " + this.label;
};

function Call(closure, identifier) {
    this.closure = closure;
    this.identifier = identifier;
}

Call.prototype.execute = function(process, stateChanges) {
    this.closure(process.pid, stateChanges);
};

Call.prototype.toString = function() {
    return "call " + this.identifier;
};

function Computer() {
    this.quantum = 5;
    this.cpus = {};
    this.programs = {
        "init": this.compile("mov ecx, -1\nbegin:\ncall wait\njmp begin")
    };
    this.restart();
}

Computer.prototype.restart = function() {
    this.roundRobin = {};
    for (var cpu in this.cpus) {
        this.cpus[cpu] = null;
        this.roundRobin[cpu] = {
            pid: null,
            time: null
        };
    }
    this.pidCounter = 2;
    this.processes = {};
    this.queue = [];
    var initProcess = new Process(1, 0, this.programs.init);
    this.toNew(initProcess);
};

Computer.prototype.addCpu = function() {
    var cpu = Object.keys(this.cpus).length;
    Vue.set(this.cpus, cpu, null);
    this.roundRobin[cpu] = {
        pid: null,
        time: null
    };
};

Computer.prototype.removeCpu = function() {
    var cpu = Object.keys(this.cpus).length - 1;
    var process = this.cpus[cpu];
    if (process) {
        this.toReady(process.pid);
    }
    Vue.delete(this.cpus, cpu);
    delete this.roundRobin[cpu];
};

Computer.prototype.toNew = function(process) {
    if (process.state) {
        throw new Error("Invalid state transition: " + process.state + " => " + State.NEW);
    }
    process.state = State.NEW;
    Vue.set(this.processes, process.pid, process);
};

Computer.prototype.toReady = function(pid) {
    var process = this.processes[pid];
    if ([State.NEW, State.READY, State.WAITING, State.RUNNING].indexOf(process.state) === -1) {
        throw new Error("Invalid state transition: " + process.state + " => " + State.READY);
    }
    process.state = State.READY;
    this.queue.push(process);
    if (process.hasOwnProperty("cpu")) {
        this.cpus[process.cpu] = null;
        Vue.delete(process, "cpu");
    }
};

Computer.prototype.toRunning = function(pid, cpu) {
    var process = this.processes[pid];
    if (process.state !== State.READY) {
        throw new Error("Invalid state transition: " + process.state + " => " + State.RUNNING);
    }
    if (this.cpus[cpu]) {
        throw new Error("CPU" + cpu + " occupied");
    }
    process.state = State.RUNNING;
    this.cpus[cpu] = process;
    Vue.set(process, "cpu", cpu);
    this.queue.splice(this.queue.indexOf(process), 1);
};

Computer.prototype.toWaiting = function(pid) {
    var process = this.processes[pid];
    if (process.state !== State.RUNNING) {
        throw new Error("Invalid state transition: " + process.state + " => " + State.WAITING);
    }
    process.state = State.WAITING;
    this.cpus[process.cpu] = null;
    Vue.delete(process, "cpu");
};

Computer.prototype.processIsWaitingFor = function(parentPid, childPid) {
    var child = this.processes[childPid];
    if (child.ppid !== parentPid) {
        return false;
    }
    var parent = this.processes[parentPid];
    if (parent) {
        var instruction = parent.program[parent.registers[Register.EIP]];
        var arg = parent.registers[Register.ECX];
        return parent.state === State.WAITING && instruction.constructor === Call &&
            instruction.identifier === "wait" && (arg === -1 || arg === childPid);
    } else {
        return false;
    }
};

Computer.prototype.toTerminated = function(pid) {
    var process = this.processes[pid];
    if (process.state !== State.RUNNING) {
        throw new Error("Invalid state transition: " + process.state + " => " + State.TERMINATED);
    }
    process.state = State.TERMINATED;
    for (var childPid in this.processes) {
        var child = this.processes[childPid];
        if (child.ppid === pid) {
            child.ppid = 1;
            if (child.state === State.TERMINATED && this.processIsWaitingFor(1, child.pid)) {
                this.toReady(1);
            }
        }
    }
    this.cpus[process.cpu] = null;
    Vue.delete(process, "cpu");
    if (this.processIsWaitingFor(process.ppid, pid)) {
        this.toReady(process.ppid);
    }
};

Computer.prototype.fork = function(pid) {
    var process = this.processes[pid];
    var forkedProcess = new Process(this.pidCounter++, pid, process.program);
    process.registers[Register.EAX] = forkedProcess.pid;
    ++process.registers[Register.EIP];
    forkedProcess.registers = JSON.parse(JSON.stringify(process.registers));
    forkedProcess.registers[Register.EAX] = 0;
    this.toNew(forkedProcess);
};

Computer.prototype.wait = function(pid, stateChanges) {
    var self = this;
    var process = this.processes[pid];
    var arg = process.registers[Register.ECX];
    if (arg === -1) {
        var children = Object.keys(this.processes).filter(function(childPid) {
            return self.processes[childPid].ppid === pid;
        });
    } else if (this.processes[arg] && this.processes[arg].ppid === process.pid) {
        children = [arg];
    } else {
        children = [];
    }
    if (children.length === 0) {
        process.registers[Register.EAX] = -1;
        ++process.registers[Register.EIP];
    } else {
        for (var i in children) {
            var child = this.processes[children[i]];
            if (child.state === State.TERMINATED) {
                process.registers[Register.EAX] = child.pid;
                Vue.delete(this.processes, child.pid);
                ++process.registers[Register.EIP];
                return;
            }
        }
        stateChanges.splice(0, 0, function() {self.toWaiting(pid);});
    }
};

Computer.prototype.yield = function(pid) {
    if (this.queue.length !== 0) {
        var process = this.processes[pid];
        this.toReady(pid);
        process.registers[Register.EAX] = 0;
        ++process.registers[Register.EIP];
    }
};

Computer.prototype.kill = function(pid, stateChanges) {
    var process = this.processes[pid];
    var arg = process.registers[Register.ECX];
    if (!this.processes[arg] || arg === 1) {
        process.registers[Register.EAX] = -1;
    } else {
        var self = this;
        var target = this.processes[arg];
        stateChanges.push(function() {
            var cpu = null;
            switch (target.state) {
                case State.NEW:
                case State.WAITING:
                    self.toReady(arg);
                case State.READY:
                    cpu = process.cpu;
                    self.toWaiting(pid);
                    self.toRunning(arg, cpu);
                case State.RUNNING:
                    self.toTerminated(arg);
                    if (cpu !== null) {
                        self.toReady(pid);
                        self.toRunning(pid, cpu);
                    }
            }
        });
        process.registers[Register.EAX] = 0;
    }
    ++process.registers[Register.EIP];
};

Computer.prototype.doCycle = function() {
    var self = this;
    for (var pid in this.processes) {
        if (this.processes[pid].state === State.NEW) {
            this.toReady(pid);
        }
    }

    var stateChanges = [];
    for (var cpu in this.cpus) {
        var process = this.cpus[cpu];
        if (process) {
            if (process.registers[Register.EIP] >= process.program.length || process.registers[Register.EIP] < 0) {
                stateChanges.push((function(process) {
                    return function() {
                        self.toTerminated(process.pid);
                    }
                })(process));
            } else {
                process.program[process.registers[Register.EIP]].execute(process, stateChanges);
            }
        }
    }

    for (var i in stateChanges) {
        stateChanges[i]();
    }

    for (cpu in this.cpus) {
        process = this.cpus[cpu];
        var roundRobin = this.roundRobin[cpu];
        if (process) {
            ++roundRobin.time;
            if (this.quantum && roundRobin.time >= this.quantum && this.queue.length !== 0) {
                this.toReady(process.pid);
            }
        }
        if (!this.cpus[cpu] && this.queue.length !== 0) {
            pid = this.queue[0].pid;
            this.toRunning(pid, cpu);
            roundRobin.pid = pid;
            roundRobin.time = 0;
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
    var labels = {};
    var program = [];
    for (var i in lines) {
        var found;
        if ((found = lines[i].match(/^\s*([a-z_]\w*):\s*$/i))) {
            var label = found[1].toLowerCase();
            if (labels.hasOwnProperty(label)) {
                return i;
            } else {
                labels[label] = program.length;
            }
        } else if ((found = lines[i].match(/^\s*(cmp|sub|mov)\s+([a-z]+),\s*([a-z]+|-?(?:0x)?\d+)\s*$/i))) {
            switch (found[1].toLowerCase()) {
                case "cmp":
                    var constructor = Compare;
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
                    return function(pid, stateChanges) {self[identifier](pid, stateChanges);}
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

Computer.prototype.getFreeCpu = function() {
    for (var cpu in this.cpus) {
        if (!this.cpus[cpu]) {
            return cpu;
        }
    }
    return null;
};

new Vue({
    el: "#app",
    data: {
        computer: new Computer(),
        selected: "init",
        name: "",
        code: "",
        errors: {},
        speed: 0,
        intervalId: null
    },
    watch: {
        speed: function(val) {
            if (this.intervalId !== null) {
                clearInterval(this.intervalId);
                this.intervalId = null;
            }
            if (val) {
                var self = this;
                this.intervalId = setInterval(function() {
                    self.computer.doCycle();
                }, 2000 / val);
            }
        }
    },
    methods: {
        getFlags: function(process) {
            return (process.registers[Register.FLAGS] & Flag.ZF) === 0 ? "-" : "ZF";
        },
        getInstruction: function(process) {
            return process.registers[Register.EIP] >= process.program.length || process.registers[Register.EIP] < 0
                ? "-"
                : process.program[process.registers[Register.EIP]].toString();
        },
        createProcess: function() {
            var process = new Process(this.computer.pidCounter++, 1, this.computer.programs[this.selected]);
            this.computer.toNew(process);
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
            if (!this.name) {
                Vue.set(this.errors, "name", "Please provide a name");
            }
            var result = this.computer.compile(this.code);
            if (!Array.isArray(result)) {
                Vue.set(this.errors, "code", "Error on line " + (parseInt(result) + 1));
            } else if (!this.errors.name) {
                Vue.set(this.computer.programs, this.name, result);
                this.selected = this.name;
                $("#editor-modal").modal("hide");
            }
        },
        readyDisabled: function(process) {
            return [State.NEW, State.WAITING, State.RUNNING].indexOf(process.state) === -1;
        },
        runningDisabled: function(process) {
            return process.state !== State.READY || Object.keys(this.computer.cpus).length === 0;
        },
        toRunning: function(process) {
            var cpu = this.computer.getFreeCpu();
            if (cpu === null) {
                cpu = 0;
                this.computer.toReady(this.computer.cpus[cpu].pid);
            }
            this.computer.toRunning(process.pid, cpu);
        }
    },
    created: function() {
        this.speed = 2;
        this.computer.addCpu();
    }
});