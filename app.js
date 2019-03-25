"use strict";

var State = {
    NEW: "NEW",
    READY: "READY",
    RUNNING: "RUNNING",
    WAITING: "WAITING",
    TERMINATED: "TERMINATED"
};

var Flag = {
    CF: 0x0001,
    ZF: 0x0040,
    SF: 0x0080,
    OF: 0x0800
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

Process.prototype.setFlags = function(unsignedResult, signedResult) {
    this.setFlag(Flag.CF, (unsignedResult >>> 0) !== unsignedResult);
    this.setFlag(Flag.ZF, (unsignedResult >>> 0) === 0);
    this.setFlag(Flag.SF, (signedResult | 0) < 0);
    this.setFlag(Flag.OF, (signedResult | 0) !== signedResult);
};

Process.prototype.doArithmetic = function(f) {
    var unsignedArgs = [];
    var signedArgs = [];
    for (var i = 1; i < arguments.length; ++i) {
        var arg = arguments[i];
        var value = arg.constructor === Operand.Register ? this.registers[arg.value] : arg.value;
        unsignedArgs.push(value >>> 0);
        signedArgs.push(value | 0);
    }
    var unsignedResult = f.apply(this, unsignedArgs);
    var signedResult = f.apply(this, signedArgs);
    this.setFlags(unsignedResult, signedResult);
    return unsignedResult;
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
        this.value = parseInt(value) >>> 0;
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

Operand.parse = function(value) {
    for (var i in Operand) {
        if (Operand[i].test(value)) {
            return new Operand[i](value);
        }
    }
    return null;
};

function ConditionalJump(condition) {
    this.operands = [Operand.Label];
    this.execute = function(process, label) {
        if (condition(process)) {
            process.registers.eip = process.program.labels[label.value];
        }
    }
}

var Instruction = {
    mov: {
        operands: [Operand.Register, [Operand.Register, Operand.Immediate]],
        execute: function(process, target, src) {
            process.registers[target.value] = src.constructor === Operand.Register ? process.registers[src.value] : src.value;
        }
    },
    cmp: {
        operands: [Operand.Register, [Operand.Register, Operand.Immediate]],
        execute: function(process, l, r) {
            process.doArithmetic(function(x, y) {return x - y}, l, r);
        }
    },
    add: {
        operands: [Operand.Register, [Operand.Register, Operand.Immediate]],
        execute: function(process, target, src) {
            process.registers[target.value] = process.doArithmetic(function(x, y) {return x + y}, target, src);
        }
    },
    sub: {
        operands: [Operand.Register, [Operand.Register, Operand.Immediate]],
        execute: function(process, target, src) {
            process.registers[target.value] = process.doArithmetic(function(x, y) {return x - y}, target, src);
        }
    },
    inc: {
        operands: [Operand.Register],
        execute: function(process, target) {
            var cf = process.isFlag(Flag.CF);
            process.registers[target.value] = process.doArithmetic(function(x) {return ++x}, target);
            process.setFlag(Flag.CF, cf);
        }
    },
    dec: {
        operands: [Operand.Register],
        execute: function(process, target) {
            var cf = process.isFlag(Flag.CF);
            process.registers[target.value] = process.doArithmetic(function(x) {return --x}, target);
            process.setFlag(Flag.CF, cf);
        }
    },
    and: {
        operands: [Operand.Register, [Operand.Register, Operand.Immediate]],
        execute: function(process, target, src) {
            process.registers[target.value] = process.doArithmetic(function(x, y) {return x & y}, target, src);
            process.setFlag(Flag.CF, false);
            process.setFlag(Flag.OF, false);
        }
    },
    or: {
        operands: [Operand.Register, [Operand.Register, Operand.Immediate]],
        execute: function(process, target, src) {
            process.registers[target.value] = process.doArithmetic(function(x, y) {return x | y}, target, src);
            process.setFlag(Flag.CF, false);
            process.setFlag(Flag.OF, false);
        }
    },
    xor: {
        operands: [Operand.Register, [Operand.Register, Operand.Immediate]],
        execute: function(process, target, src) {
            process.registers[target.value] = process.doArithmetic(function(x, y) {return x ^ y}, target, src);
            process.setFlag(Flag.CF, false);
            process.setFlag(Flag.OF, false);
        }
    },
    not: {
        operands: [Operand.Register],
        execute: function(process, target) {
            process.registers[target.value] = ~process.registers[target.value];
        }
    },
    neg: {
        operands: [Operand.Register],
        execute: function(process, target) {
            process.registers[target.value] = process.doArithmetic(function(x) {return -x}, target);
        }
    },
    int: {
        operands: [Operand.Immediate],
        execute: function(process, interrupt) {
            if (interrupt.value === 0x80) {
                this.sysCall(process.pid);
            }
        }
    },
    jmp: new ConditionalJump(function() {return true}),
    je: new ConditionalJump(function(process) {return process.isFlag(Flag.ZF)}),
    jne: new ConditionalJump(function(process) {return !process.isFlag(Flag.ZF)}),
    jg: new ConditionalJump(function(process) {return process.isFlag(Flag.SF) === process.isFlag(Flag.OF) && !process.isFlag(Flag.ZF)}),
    jge: new ConditionalJump(function(process) {return process.isFlag(Flag.SF) === process.isFlag(Flag.OF) || process.isFlag(Flag.ZF)}),
    ja: new ConditionalJump(function(process) {return !process.isFlag(Flag.CF) && !process.isFlag(Flag.ZF)}),
    jae: new ConditionalJump(function(process) {return !process.isFlag(Flag.CF) || process.isFlag(Flag.ZF)}),
    jl: new ConditionalJump(function(process) {return process.isFlag(Flag.SF) !== process.isFlag(Flag.OF)}),
    jle: new ConditionalJump(function(process) {return process.isFlag(Flag.SF) !== process.isFlag(Flag.OF) || process.isFlag(Flag.ZF)}),
    jb: new ConditionalJump(function(process) {return process.isFlag(Flag.CF)}),
    jbe: new ConditionalJump(function(process) {return process.isFlag(Flag.CF) || process.isFlag(Flag.ZF)}),
    jo: new ConditionalJump(function (process) {return process.isFlag(Flag.OF)}),
    jno: new ConditionalJump(function (process) {return !process.isFlag(Flag.OF)}),
    js: new ConditionalJump(function(process) {return process.isFlag(Flag.SF)}),
    jns: new ConditionalJump(function(process) {return !process.isFlag(Flag.SF)})
};

Instruction.jz = Instruction.je;
Instruction.jnz = Instruction.jne;

Program.compile = function(code) {
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
                        var operand = Operand.parse(operandValues[i]);
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
};

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
    this.initProgram = Program.compile("mov ebx, -1\nbegin:\nmov eax, 0x07\nint 0x80\njmp begin");
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
        delete process.cpu;
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
    process.cpu = cpu;
    this.queue.splice(this.queue.indexOf(process), 1);
};

Computer.prototype.toWaiting = function(pid) {
    var process = this.processes[pid];
    if (process.state !== State.RUNNING) {
        throw new Error("Invalid state transition: " + process.state + " => " + State.WAITING);
    }
    process.state = State.WAITING;
    this.cpus[process.cpu].pid = null;
    delete process.cpu;
};

Computer.prototype.processIsWaitingFor = function(parentPid, childPid) {
    var child = this.processes[childPid];
    if (child.ppid !== parentPid) {
        return false;
    }
    var parent = this.processes[parentPid];
    if (parent) {
        var arg = parent.registers.ebx | 0;
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
    delete process.cpu;
    if (this.processIsWaitingFor(process.ppid, pid)) {
        this.waitpidReturn(process.ppid, pid);
    }
};

Computer.prototype.fork = function(pid) {
    var process = this.processes[pid];
    var forkedProcess = new Process(this.pidCounter++, pid, process.program);
    process.registers.eax = forkedProcess.pid;
    forkedProcess.registers = JSON.parse(JSON.stringify(process.registers));
    forkedProcess.registers.eax = 0;
    this.toNew(forkedProcess);
};

Computer.prototype.waitpid = function(pid) {
    var process = this.processes[pid];
    var arg = process.registers.ebx | 0;
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
    } else {
        for (var i in children) {
            var child = this.processes[children[i]];
            if (child.state === State.TERMINATED) {
                this.waitpidReturn(pid, child.pid);
                return;
            }
        }
        process.waitpid = true;
        this.toWaiting(pid);
    }
};

Computer.prototype.kill = function(pid) {
    var process = this.processes[pid];
    var arg = process.registers.ebx | 0;
    if (arg === -1) {
        var targets = [];
        for (var otherPidStr in this.processes) {
            var otherPid = parseInt(otherPidStr);
            if (otherPid !== 1 && otherPid !== pid) {
                targets.push(otherPidStr);
            }
        }
    } else if (!this.processes[arg] || arg === 1 || this.processes[arg].state === State.TERMINATED) {
        process.registers.eax = -1;
        return;
    } else {
        targets = [arg];
    }
    for (var i in targets) {
        var target = this.processes[targets[i]];
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
    process.registers.eax = 0;
};

Computer.prototype.sched_yield = function(pid) {
    if (this.queue.length) {
        this.toReady(pid);
    }
    var process = this.processes[pid];
    this.processes[pid].registers.eax = 0;
};

Computer.sysCalls = {
    0x01: Computer.prototype.toTerminated,
    0x02: Computer.prototype.fork,
    0x07: Computer.prototype.waitpid,
    0x25: Computer.prototype.kill,
    0x9e: Computer.prototype.sched_yield
};

Computer.prototype.sysCall = function(pid) {
    var process = this.processes[pid];
    var sysCall = Computer.sysCalls[process.registers.eax];
    if (sysCall) {
        sysCall.call(this, pid);
    } else {
        process.registers.eax = -14;
    }
};

Computer.prototype.doCycle = function() {
    var self = this;
    for (var pid in this.processes) {
        if (this.processes[pid].state === State.NEW) {
            this.toReady(pid);
        }
    }

    for (var cpu in this.cpus) {
        var info = this.cpus[cpu];
        if (info.pid) {
            var process = this.processes[info.pid];
            if (process.registers.eip >= process.program.instructions.length || process.registers.eip < 0) {
                this.toTerminated(process.pid);
            } else {
                process.program.instructions[process.registers.eip++].execute.call(this, process);
                for (var register in process.registers) {
                    process.registers[register] >>>= 0;
                }
            }
        }
    }

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

(function() {
    var codeMirror = null;
    var intervalId = null;

    new Vue({
        el: "#app",
        data: {
            computer: new Computer(),
            programs: {},
            selectedProgram: null,
            name: "",
            errors: {},
            speed: 0
        },
        watch: {
            speed: function(val) {
                if (intervalId !== null) {
                    clearInterval(intervalId);
                    intervalId = null;
                }
                if (val) {
                    var self = this;
                    intervalId = setInterval(function() {
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
            toHexString: function(number) {
                var value = (number >>> 0).toString(16);
                while (value.length < 8) {
                    value = 0 + value;
                }
                return "0x" + value;
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
                codeMirror.setValue("");
                this.errors = {};
            },
            openEdit: function() {
                this.name = this.selectedProgram;
                codeMirror.setValue(this.programs[this.selectedProgram].code);
                this.errors = {};
            },
            deleteProgram: function() {
                Vue.delete(this.programs, this.selectedProgram);
                this.selectedProgram = Object.keys(this.programs).length === 0 ? null : Object.keys(this.programs)[0];
            },
            save: function() {
                this.errors = {};
                if (!this.name) {
                    Vue.set(this.errors, "name", "Please provide a name");
                }
                try {
                    var program = Program.compile(codeMirror.getValue());
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
            codeMirror = CodeMirror.fromTextArea(document.getElementById("code"), {
                lineNumbers: true,
                architecture: "x86"
            });
            $("#editor-modal").on("shown.bs.modal", function() {
                codeMirror.refresh();
            });
        }
    });
})();
