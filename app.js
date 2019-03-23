"use strict";

var State = {
    NEW: "NEW",
    READY: "READY",
    RUNNING: "RUNNING",
    WAITING: "WAITING",
    TERMINATED: "TERMINATED"
};

var Flag = {
    ZF: 0x0040,
    SF: 0x0080
};

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

Process.prototype.isFlag = function(flag) {
    return (this.registers.eflags & flag) !== 0;
};

Process.prototype.setFlag = function(flag, set) {
    if (set) {
        this.registers.eflags |= flag;
    } else {
        this.registers.eflags &= ~flag;
    }
};

function Program(code, instructions, labels) {
    this.code = code;
    this.instructions = instructions;
    this.labels = labels;
}

var Operand = {
    Register: function(value) {
        this.value = value.toLowerCase();
        this.toString = function() {
            return value;
        }
    },
    Immediate: function(value) {
        this.value = parseInt(value);
        this.toString = function() {
            return value;
        }
    },
    Label: function(value) {
        this.value = value.toLowerCase();
        this.toString = function() {
            return value;
        }
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

Operand.Immediate.test = function(value) {
    return /^[+-]?(?:[0-9]+|0x[0-9a-f]+)$/i.test(value);
};

Operand.Label.test = function(value) {
    return /^[a-z_]\w*$/i.test(value) && !Operand.Register.test(value)
};

function parseOperand(value) {
    for (var i in Operand) {
        if (Operand[i].test(value)) {
            return new Operand[i](value);
        }
    }
    return null;
}

function setFlags(process, result) {
    process.setFlag(Flag.ZF, result === 0);
    process.setFlag(Flag.SF, result < 0);
}

function ConditionalJump(condition) {
    this.operands = [
        Operand.Label
    ];
    this.execute = function(process, label) {
        if (condition(process)) {
            process.registers.eip = process.program.labels[label.value];
        } else {
            ++process.registers.eip;
        }
    }
}

var Instruction = {
    mov: {
        operands: [
            Operand.Register,
            [Operand.Register, Operand.Immediate]
        ],
        execute: function(process, target, src) {
            process.registers[target.value] = src.constructor === Operand.Register ? process.registers[src.value] : src.value;
            ++process.registers.eip;
        }
    },
    add: {
        operands: [
            Operand.Register,
            [Operand.Register, Operand.Immediate]
        ],
        execute: function(process, target, src) {
            var srcVal = src.constructor === Operand.Register ? process.registers[src.value] : src.value;
            process.registers[target.value] += srcVal;
            setFlags(process, process.registers[target.value]);
            ++process.registers.eip;
        }
    },
    sub: {
        operands: [
            Operand.Register,
            [Operand.Register, Operand.Immediate]
        ],
        execute: function(process, target, src) {
            var srcVal = src.constructor === Operand.Register ? process.registers[src.value] : src.value;
            process.registers[target.value] -= srcVal;
            setFlags(process, process.registers[target.value]);
            ++process.registers.eip;
        }
    },
    cmp: {
        operands: [
            Operand.Register,
            [Operand.Register, Operand.Immediate]
        ],
        execute: function(process, l, r) {
            var rVal = r.constructor === Operand.Register ? process.registers[r.value] : r.value;
            setFlags(process, process.registers[l.value] - rVal);
            ++process.registers.eip;
        }
    },
    int: {
        operands: [
            Operand.Immediate
        ],
        execute: function(process, interrupt) {
            if (interrupt.value === 0x80) {
                var sysCall = sysCalls[process.registers.eax];
                if (sysCall) {
                    sysCall.call(this, process.pid);
                    return;
                }
            }
            ++process.registers.eip;
        }
    },
    jmp: new ConditionalJump(function() {return true}),
    je: new ConditionalJump(function(process) {return process.isFlag(Flag.ZF)}),
    jne: new ConditionalJump(function(process) {return !process.isFlag(Flag.ZF)}),
    jg: new ConditionalJump(function(process) {return !process.isFlag(Flag.SF) && !process.isFlag(Flag.ZF)}),
    jge: new ConditionalJump(function(process) {return !process.isFlag(Flag.SF) || process.isFlag(Flag.ZF)}),
    jl: new ConditionalJump(function(process) {return process.isFlag(Flag.SF) && !process.isFlag(Flag.ZF)}),
    jle: new ConditionalJump(function(process) {return process.isFlag(Flag.SF) || process.isFlag(Flag.ZF)}),
    js: new ConditionalJump(function(process) {return process.isFlag(Flag.SF)}),
    jns: new ConditionalJump(function(process) {return !process.isFlag(Flag.SF)})
};

Instruction.jz = Instruction.je;
Instruction.jnz = Instruction.jne;

function compile(code) {
    var lines = code.split("\n");
    var regex = /^\s*(?:([a-z_]\w*):)?\s*(?:([a-z]+)\s*(?:\s((?:[^\s,#]+)(?:\s*,\s*(?:[^\s,#]+))*)\s*)?)?(?:#.*)?$/i;
    var instructions = [];
    var labels = {};
    var errors = [];
    for (var lineNumber in lines) {
        var matches = regex.exec(lines[lineNumber]);
        if (!matches) {
            errors.push({
                lineNumber: lineNumber,
                msg: "syntax error"
            });
            continue;
        }
        if (matches[1]) {
            var label = matches[1].toLowerCase();
            if (labels.hasOwnProperty(label)) {
                errors.push({
                    lineNumber: lineNumber,
                    msg: "duplicate label declaration"
                });
            } else {
                labels[label] = instructions.length;
            }
        }
        if (matches[2]) {
            var mnemonic = matches[2].toLowerCase();
            if (Instruction.hasOwnProperty(mnemonic)) {
                var operands = [];
                var hasError = false;
                if (matches[3]) {
                    var operandValues = matches[3].split(/\s*,\s*/);
                    for (var i in operandValues) {
                        var operand = parseOperand(operandValues[i]);
                        if (operand !== null) {
                            operands.push(operand);
                        } else {
                            errors.push({
                                lineNumber: lineNumber,
                                msg: "unrecognized operand \"" + operandValues[i] + "\""
                            });
                            hasError = true;
                        }
                    }
                }
                if (hasError) {
                    continue;
                }
                var instruction = Instruction[mnemonic];
                if (instruction.operands.length === operands.length) {
                    var labelOperands = [];
                    for (i in instruction.operands) {
                        if (Array.isArray(instruction.operands[i]) && instruction.operands[i].indexOf(operands[i].constructor) === -1 ||
                            !Array.isArray(instruction.operands[i]) && instruction.operands[i] !== operands[i].constructor) {

                            errors.push({
                                lineNumber: lineNumber,
                                msg: "invalid type of operand " + (parseInt(i) + 1) + ", expected " + instruction.operands[i]
                            });
                            hasError = true;
                            continue;
                        }
                        if (operands[i].constructor === Operand.Label) {
                            labelOperands.push(operands[i]);
                        }
                    }
                    if (hasError) {
                        continue;
                    }
                    var closure = (function(mnemonic, operands) {
                        return {
                            execute: function(process) {
                                Instruction[mnemonic].execute.apply(this, [process].concat(operands));
                            },
                            toString: function() {
                                return mnemonic + (operands.length ? " " + operands.join(", ") : "");
                            }
                        }
                    })(mnemonic, operands);
                    if (labelOperands.length) {
                        instructions.push({
                            placeholder: true,
                            lineNumber: lineNumber,
                            labelOperands: labelOperands,
                            closure: closure
                        });
                    } else {
                        instructions.push(closure);
                    }
                } else {
                    errors.push({
                        lineNumber: lineNumber,
                        msg: "invalid number of operands (" + operands.length + ", expected " + Instruction[mnemonic].operands.length + ")"
                    });
                }
            } else {
                errors.push({
                    lineNumber: lineNumber,
                    msg: "unrecognized instruction \"" + mnemonic + "\""
                });
            }
        }
    }
    for (i in instructions) {
        if (instructions[i].placeholder) {
            for (var j in instructions[i].labelOperands) {
                label = instructions[i].labelOperands[j];
                if (!labels.hasOwnProperty(label.value)) {
                    errors.push({
                        lineNumber: instructions[i].lineNumber,
                        msg: "undeclared label \"" + label + "\""
                    });
                }
            }
            instructions[i] = instructions[i].closure;
        }
    }
    if (Object.keys(errors).length) {
        throw errors;
    }
    return new Program(code, instructions, labels);
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
    this.initProgram = compile("mov ebx, -1\nbegin:\nmov eax, 0x07\nint 0x80\njmp begin");
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

Computer.prototype.waitpidReturn = function(parentPid, childPid) {
    var parent = this.processes[parentPid];
    var child = this.processes[childPid];
    parent.registers.eax = child.pid;
    Vue.delete(this.processes, child.pid);
    delete parent.waitpid;
    ++parent.registers.eip;
    if (parent.state === State.WAITING) {
        this.toReady(parentPid);
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
                this.waitpidReturn(1, child.pid);
            }
        }
    }
    this.cpus[process.cpu].pid = null;
    Vue.delete(process, "cpu");
    if (this.processIsWaitingFor(process.ppid, pid)) {
        this.waitpidReturn(process.ppid, pid);
    }
};

Computer.prototype.exit = function(pid) {
    this.toTerminated(pid);
    ++this.processes[pid].registers.eip;
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
        var self = this;
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
                this.waitpidReturn(pid, child.pid);
                return;
            }
        }
        process.waitpid = true;
        this.stateChanges.splice(0, 0, function() {this.toWaiting(pid);});
    }
};

Computer.prototype.kill = function(pid) {
    var process = this.processes[pid];
    var arg = process.registers.ebx;
    var targets = [];
    if (arg === -1) {
        for (var otherPidStr in this.processes) {
            var otherPid = parseInt(otherPidStr);
            if (otherPid !== 1 && otherPid !== pid) {
                targets.push(otherPidStr);
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
                        this.toReady(target.pid);
                    case State.READY:
                        cpu = process.cpu;
                        this.toWaiting(pid);
                        this.toRunning(target.pid, cpu);
                    case State.RUNNING:
                        this.toTerminated(target.pid);
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

Computer.prototype.sched_yield = function(pid) {
    if (this.queue.length) {
        this.toReady(pid);
    }
    var process = this.processes[pid];
    this.processes[pid].registers.eax = 0;
    ++process.registers.eip;
};

var sysCalls = {
    0x01: Computer.prototype.exit,
    0x02: Computer.prototype.fork,
    0x07: Computer.prototype.waitpid,
    0x25: Computer.prototype.kill,
    0x9e: Computer.prototype.sched_yield
};

Computer.prototype.doCycle = function() {
    var self = this;
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
                process.program.instructions[process.registers.eip].execute.call(this, process);
            }
        }
    }

    for (var i in this.stateChanges) {
        this.stateChanges[i].call(this);
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
        programs: {},
        selectedProgram: null,
        name: "",
        codeMirror: null,
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
            var flags = [];
            for (var flag in Flag) {
                if (process.isFlag(Flag[flag])) {
                    flags.push(flag);
                }
            }
            return flags.length ? flags.join(" ") : "-";
        },
        getInstruction: function(process) {
            return process.registers.eip >= process.program.instructions.length || process.registers.eip < 0
                ? "-"
                : process.program.instructions[process.registers.eip];
        },
        createProcess: function() {
            var process = new Process(this.computer.pidCounter++, 1, this.programs[this.selectedProgram]);
            this.computer.toNew(process);
        },
        openNew: function() {
            this.name = "";
            this.codeMirror.setValue();
            this.errors = {};
        },
        openEdit: function() {
            this.name = this.selectedProgram;
            this.codeMirror.setValue(this.programs[this.selectedProgram].code);
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
                var program = compile(this.codeMirror.getValue());
                if (!this.errors.name) {
                    Vue.set(this.programs, this.name, program);
                    this.selectedProgram = this.name;
                    $("#editor-modal").modal("hide");
                }
            } catch (errors) {
                Vue.set(this.errors, "code", errors);
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
        this.programs.init = this.computer.initProgram;
        this.selectedProgram = "init";
        this.computer.addCpu();
    },
    mounted: function() {
        var codeMirror = CodeMirror.fromTextArea(document.getElementById("code"), {
            lineNumbers: true,
            architecture: "x86"
        });
        var markers = [];
        this.codeMirror = codeMirror;
        $("#editor-modal").on("shown.bs.modal", function() {
            codeMirror.refresh();
        });
        $(".CodeMirror").addClass("form-control p-0");
    }
});
