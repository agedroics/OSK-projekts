"use strict";

var State = {
    NEW: "NEW",
    READY: "READY",
    RUNNING: "RUNNING",
    WAITING: "WAITING",
    TERMINATED: "TERMINATED"
};

var Flag = {
    ZF: 0x0040
};

var sysCalls = new Map([
    [0x01, Computer.prototype.exit],
    [0x02, Computer.prototype.fork],
    [0x07, Computer.prototype.waitpid],
    [0x25, Computer.prototype.kill],
    [0x9e, Computer.prototype.sched_yield]
]);

var registers = ["eax", "ebx", "ecx", "edx"];

function Registers() {
    for (var i in registers) {
        this[registers[i]] = 0;
    }
    this.eip = 0;
    this.eflags = 0;
}

function Process(pid, ppid, program) {
    this.pid = pid;
    this.ppid = ppid;
    this.program = program;
    this.registers = new Registers();
}

function Program(code, instructions, labels) {
    this.code = code;
    this.instructions = instructions;
    this.labels = labels;
}

var Operand = {
    Register: function(value) {
        this.value = value.toLowerCase();
    },
    Immediate: function(value) {
        if (!isNaN(value)) {
            this.value = parseInt(value);
        } else {
            this.value = parseInt(value.slice(0, -1));
        }
    },
    Label: function(value) {
        this.value = value.toLowerCase();
    }
};

for (var operand in Operand) {
    Operand[operand].toString = (function(operand) {
        return function() {
            return operand;
        }
    })(operand);
}

Operand.Register.test = function(value) {
    return registers.indexOf(value.toLowerCase()) !== -1;
};
Operand.Register.prototype.toString = function() {
    return this.value;
};

Operand.Immediate.test = function(value) {
    return /^[+-]?(?:[0-9]+|0x[0-9a-f]+|[0-9a-f]+h)$/i.test(value);
};
Operand.Immediate.prototype.toString = function() {
    return this.value.toString();
};

Operand.Label.test = function(value) {
    return /^[a-z_]\w*$/i.test(value) && !Operand.Register.test(value)
};
Operand.Label.prototype.toString = function() {
    return this.value;
};

function parseOperand(value) {
    for (var i in Operand) {
        if (Operand[i].test(value)) {
            return new Operand[i](value);
        }
    }
    return null;
}

var Instruction = {
    mov: {
        operands: [
            Operand.Register,
            [Operand.Register, Operand.Immediate]
        ],
        execute: function(process, target, src) {
            process.registers[target.value] = src.constructor === Operand.Register ? process.registers[src.value] : src;
            ++process.registers.eip;
        }
    },
    add: {
        operands: [
            Operand.Register,
            [Operand.Register, Operand.Immediate]
        ],
        execute: function(process, target, src) {
            var srcVal = src.constructor === Operand.Register ? process.registers[src.value] : src;
            process.registers[target.value] += srcVal;
            if (process.registers[target.value] === 0) {
                process.registers.eflags &= ~Flag.ZF;
            } else {
                process.registers.eflags |= Flag.ZF;
            }
            ++process.registers.eip;
        }
    },
    sub: {
        operands: [
            Operand.Register,
            [Operand.Register, Operand.Immediate]
        ],
        execute: function(process, target, src) {
            var srcVal = src.constructor === Operand.Register ? process.registers[src.value] : src;
            process.registers[target.value] -= srcVal;
            if (process.registers[target.value] === 0) {
                process.registers.eflags &= ~Flag.ZF;
            } else {
                process.registers.eflags |= Flag.ZF;
            }
            ++process.registers.eip;
        }
    },
    cmp: {
        operands: [
            Operand.Register,
            [Operand.Register, Operand.Immediate]
        ],
        execute: function(process, l, r) {
            var rVal = r.constructor === Operand.Register ? process.registers[r.value] : r;
            var result = process.registers[l.value] - rVal;
            if (result === 0) {
                process.registers.eflags |= Flag.ZF;
            } else {
                process.registers.eflags &= ~Flag.ZF;
            }
            ++process.registers.eip;
        }
    },
    int: {
        operands: [
            Operand.Immediate
        ],
        execute: function(process, interrupt) {
            if (interrupt === 0x80) {
                var sysCall = sysCalls.get(process.registers.eax);
                if (sysCall) {
                    sysCall(process.pid);
                } else {
                    ++process.registers.eip;
                }
            }
        }
    },
    jmp: {
        operands: [
            Operand.Label
        ],
        execute: function(process, label) {
            process.registers.eip = process.program.labels[label];
        }
    },
    je: {
        operands: [
            Operand.Label
        ],
        execute: function(process, label) {
            if (process.registers.eflags & Flag.ZF) {
                process.registers.eip = process.program.labels[label];
            }
        }
    },
    jne: {
        operands: [
            Operand.Label
        ],
        execute: function(process, label) {
            if ((process.registers.eflags & Flag.ZF) === 0) {
                process.registers.eip = process.program.labels[label];
            }
        }
    }
};

Instruction.jz = Instruction.je;
Instruction.jnz = Instruction.jne;

function compile(code) {
    var lines = code.split("\n");
    var regex = /^\s*(?:([a-z_]\w*):)?\s*(?:([a-z]+)\s*(?:\s((?:[^\s,;]+)(?:\s*,\s*(?:[^\s,;]+))*)\s*)?)?(?:;.*)?$/i;
    var instructions = [];
    var labels = {};
    var error = null;
    for (var lineNumber in lines) {
        var matches = regex.exec(lines[lineNumber]);
        if (!matches) {
            error = "syntax error";
            break;
        }
        if (matches[1]) {
            var label = matches[1].toLowerCase();
            if (labels.hasOwnProperty(label)) {
                error = "duplicate label declaration";
                break;
            } else {
                labels[label] = instructions.length;
            }
        }
        if (matches[2]) {
            var mnemonic = matches[2].toLowerCase();
            if (Instruction.hasOwnProperty(mnemonic)) {
                var operands = [];
                if (matches[3]) {
                    var operandValues = matches[3].split(/\s*,\s*/);
                    for (var i in operandValues) {
                        var operand = parseOperand(operandValues[i]);
                        if (operand !== null) {
                            operands.push(operand);
                        } else {
                            error = "unrecognized operand " + operandValues[i];
                            break;
                        }
                    }
                }
                var instruction = Instruction[mnemonic];
                if (instruction.operands.length === operands.length) {
                    for (i in instruction.operands) {
                        if (Array.isArray(instruction.operands[i]) && instruction.operands[i].indexOf(operands[i].constructor) === -1 ||
                            !Array.isArray(instruction.operands[i]) && instruction.operands[i] !== operands[i].constructor) {

                            error = "invalid operand type at position " + (parseInt(i) + 1) + ", expected " + instruction.operands[i];
                            break;
                        }
                    }
                    instructions.push((function(mnemonic, operands) {
                        return {
                            execute: function(process) {
                                Instruction[mnemonic].execute.apply(this, [process].concat(operands));
                            },
                            toString: function() {
                                return mnemonic + (operands.length ? " " + operands.join(", ") : "");
                            }
                        }
                    })(mnemonic, operands));
                } else {
                    error = "invalid number of operands " + operands.length + ", expected " + Instruction[mnemonic].operands.length;
                    break;
                }
            } else {
                error = "unrecognized instruction " + mnemonic;
                break;
            }
        }
    }
    if (error) {
        throw new Error("Error on line " + (parseInt(lineNumber) + 1) + ": " + error);
    } else {
        return new Program(code, instructions, labels);
    }
}

function Scheduler(quantum) {
    this.quantum = quantum;
}

Scheduler.prototype.run = function(computer) {
    for (var cpu in computer.cpus) {
        var info = computer.cpus[cpu];
        if (!info.hasOwnProperty("time")) {
            info.time = 0;
        }
        if (info.pid !== null) {
            ++info.time;
            if (this.quantum && info.time >= this.quantum && computer.queue.length) {
                computer.toReady(info.pid);
            }
        }
        if (info.pid === null && computer.queue.length) {
            var pid = computer.queue[0].pid;
            computer.toRunning(pid, cpu);
            info.time = 0;
        }
    }
};

function Cpu() {
    this.pid = null;
}

function Computer() {
    this.cpus = {};
    this.scheduler = new Scheduler(5);
    this.initProgram = compile("mov ebx,-1\nbegin:mov eax,07h\nint 80h\njmp begin");
    this.restart();
}

Computer.prototype.restart = function() {
    for (var cpu in this.cpus) {
        this.cpus[cpu] = new Cpu();
    }
    this.pidCounter = 2;
    this.processes = {};
    this.queue = [];
    var initProcess = new Process(1, 0, this.initProgram);
    this.toNew(initProcess);
};

Computer.prototype.addCpu = function() {
    var cpu = Object.keys(this.cpus).length;
    Vue.set(this.cpus, cpu, new Cpu());
};

Computer.prototype.removeCpu = function() {
    var cpu = Object.keys(this.cpus).length - 1;
    var info = this.cpus[cpu];
    if (info.pid !== null) {
        this.toReady(info.pid);
    }
    Vue.delete(this.cpus, cpu);
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
    if ([State.NEW, State.WAITING, State.RUNNING].indexOf(process.state) === -1) {
        throw new Error("Invalid state transition: " + process.state + " => " + State.READY);
    }
    process.state = State.READY;
    this.queue.push(process);
    if (process.hasOwnProperty("cpu")) {
        this.cpus[process.cpu].pid = null;
        Vue.delete(process, "cpu");
    }
};

Computer.prototype.toRunning = function(pid, cpu) {
    var process = this.processes[pid];
    if (process.state !== State.READY) {
        throw new Error("Invalid state transition: " + process.state + " => " + State.RUNNING);
    }
    if (this.cpus[cpu].pid !== null) {
        throw new Error("CPU" + cpu + " occupied");
    }
    process.state = State.RUNNING;
    this.cpus[cpu].pid = pid;
    Vue.set(process, "cpu", cpu);
    this.queue.splice(this.queue.indexOf(process), 1);
};

Computer.prototype.toWaiting = function(pid) {
    var process = this.processes[pid];
    if (process.state !== State.RUNNING) {
        throw new Error("Invalid state transition: " + process.state + " => " + State.WAITING);
    }
    process.state = State.WAITING;
    this.cpus[process.cpu].pid = null;
    Vue.delete(process, "cpu");
};

Computer.prototype.processIsWaitingFor = function(parentPid, childPid) {
    var child = this.processes[childPid];
    if (child.ppid !== parentPid) {
        return false;
    }
    var parent = this.processes[parentPid];
    if (parent) {
        var arg = parent.registers.ebx;
        return parent.waitpid && parent.state === State.WAITING && (arg === -1 || arg === childPid);
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
    this.cpus[process.cpu].pid = null;
    Vue.delete(process, "cpu");
    if (this.processIsWaitingFor(process.ppid, pid)) {
        this.toReady(process.ppid);
    }
};

Computer.prototype.fork = function(pid) {
    var process = this.processes[pid];
    var forkedProcess = new Process(this.pidCounter++, pid, process.program);
    process.registers.eax = forkedProcess.pid;
    ++process.registers.eip;
    forkedProcess.registers = JSON.parse(JSON.stringify(process.registers));
    forkedProcess.registers.eax = 0;
    this.toNew(forkedProcess);
};

Computer.prototype.waitpid = function(pid) {
    var process = this.processes[pid];
    var arg = process.registers.ebx;
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
        process.registers.eax = -1;
        ++process.registers.eip;
    } else {
        for (var i in children) {
            var child = this.processes[children[i]];
            if (child.state === State.TERMINATED) {
                process.registers.eax = child.pid;
                Vue.delete(this.processes, child.pid);
                delete process.waitpid;
                ++process.registers.eip;
                return;
            }
        }
        process.waitpid = true;
        this.stateChanges.splice(0, 0, function() {this.toWaiting(pid);});
    }
};

Computer.prototype.sched_yield = function(pid) {
    if (this.queue.length) {
        this.toReady(pid);
    }
    var process = this.processes[pid];
    this.processes[pid].registers.eax = 0;
    ++process.registers.eip;
};

Computer.prototype.kill = function(pid) {
    var process = this.processes[pid];
    var arg = process.registers.eax;
    var targets = [];
    if (arg === -1) {
        for (var otherPid in this.processes) {
            if (parseInt(otherPid) !== 1 && otherPid !== pid) {
                targets.push(otherPid);
            }
        }
    } else if (!this.processes[arg] || arg === 1) {
        process.registers.eax = -1;
    } else {
        targets.push(arg);
    }
    for (var i in targets) {
        var target = this.processes[targets[i]];
        this.stateChanges.push((function(target) {
            return function() {
                var cpu = null;
                switch (target.state) {
                    case State.NEW:
                    case State.WAITING:
                        this.toReady(arg);
                    case State.READY:
                        cpu = process.cpu;
                        this.toWaiting(pid);
                        this.toRunning(arg, cpu);
                    case State.RUNNING:
                        this.toTerminated(arg);
                        if (cpu !== null) {
                            this.toReady(pid);
                            this.toRunning(pid, cpu);
                        }
                }
            }
        })(target));
        process.registers.eax = 0;
    }
    ++process.registers.eip;
};

Computer.prototype.doCycle = function() {
    for (var pid in this.processes) {
        if (this.processes[pid].state === State.NEW) {
            this.toReady(pid);
        }
    }

    this.stateChanges = [];
    for (var cpu in this.cpus) {
        var info = this.cpus[cpu];
        if (info.pid) {
            var process = this.processes[info.pid];
            if (process.registers.eip >= process.program.instructions.length || process.registers.eip < 0) {
                this.stateChanges.push((function(process) {
                    return function() {
                        this.toTerminated(process.pid);
                    }
                })(process));
            } else {
                process.program.instructions[process.registers.eip].execute(process);
            }
        }
    }

    for (var i in this.stateChanges) {
        this.stateChanges[i]();
    }
    delete this.stateChanges;

    this.scheduler.run(this);
};

Computer.prototype.getFreeCpu = function() {
    for (var cpu in this.cpus) {
        if (this.cpus[cpu].pid === null) {
            return cpu;
        }
    }
    return null;
};

new Vue({
    el: "#app",
    data: {
        computer: new Computer(),
        programs: {
            "init": compile("mov ebx,-1\nbegin:mov eax,07h\nint 80h\njmp begin")
        },
        selectedProgram: "init",
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
            return process.registers.eflags & Flag.ZF ? "ZF" : "-";
        },
        getInstruction: function(process) {
            return process.registers.eip >= process.program.instructions.length || process.registers.eip < 0
                ? "-"
                : process.program.instructions[process.registers.eip].toString();
        },
        createProcess: function() {
            var process = new Process(this.computer.pidCounter++, 1, this.programs[this.selectedProgram]);
            this.computer.toNew(process);
        },
        openNew: function() {
            this.name = "";
            this.code = "";
            this.errors = {};
        },
        openEdit: function() {
            this.name = this.selectedProgram;
            this.code = this.programs[this.selectedProgram].code;
            this.errors = {};
        },
        deleteProgram: function() {
            Vue.delete(this.computer.programs, this.selected);
            this.selectedProgram = Object.keys(this.programs).length === 0 ? null : Object.keys(this.programs)[0];
        },
        save: function() {
            this.errors = {};
            if (!this.name) {
                Vue.set(this.errors, "name", "Please provide a name");
            }
            try {
                var program = compile(this.code);
                if (!this.errors.name) {
                    Vue.set(this.programs, this.name, program);
                    this.selectedProgram = this.name;
                    $("#editor-modal").modal("hide");
                }
            } catch (e) {
                Vue.set(this.errors, "code", e.message);
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
