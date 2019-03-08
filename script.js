"use strict";

var counter = 0;

var State = Object.freeze({
    NEW: "NEW",
    READY: "READY",
    RUNNING: "RUNNING",
    WAITING: "WAITING",
    TERMINATED: "TERMINATED"
});

function ControlBlock(pid, pc, state, registers) {
    this.pid = pid;
    this.pc = pc;
    this.state = state;
    this.registers = registers;
}

function Process(controlBlock, program) {
    this.controlBlock = controlBlock;
    this.program = program;
}

var Computer = {
    cpus: {},
    allProcesses: {},
    readyQueue: [],
    waiting: []
};

Computer.createProcess = function(process) {
    this.allProcesses[process.controlBlock.pid] = process;
}

Computer.blockProcess = function(pid) {
    for (var cpu in this.cpus) {
        if (this.cpus[cpu].controlBlock.pid === pid) {
            var process = this.cpus[cpu];
            this.cpus[cpu] = null;
            process.state = State.WAITING;
            this.waiting.push(process);
            break;
        }
    }
}

Computer.wakeProcess = function(pid) {
    for (var i = 0; i < this.waiting.length; ++i) {
        if (this.waiting[i].controlBlock.pid === pid) {
            var process = this.waiting[i];
            this.waiting.splice(i, 1);
            process.state = State.READY;
            this.readyQueue.push(process);
            break;
        }
    }
}

Computer.doCycle = function() {
    while (this.readyQueue.length !== 0) {
        var assigned = false;
        for (var cpu in this.cpus) {
            if (!this.cpus[cpu]) {
                this.cpus[cpu] = this.readyQueue[0];
                this.readyQueue.splice(0, 1);
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            break;
        }
    }

    for (var cpu in this.cpus) {
        var process = this.cpus[cpu];
        if (process) {
            if (process.controlBlock.pc < process.program.length) {
                process.program[process.controlBlock.pc].execute(process);
            } else {
                this.cpus[cpu] = null;
                process.controlBlock.state = State.TERMINATED;
            }
        }
    }

    for (var i = 0; i < this.waiting.length; ++i) {
        if (this.waiting[i].wakeCondition()) {
            this.wakeProcess(this.waiting[i].ControlBlock.pid);
        }
    }

    for (var pid in this.allProcesses) {
        var controlBlock = this.allProcesses[pid].controlBlock;
        if (controlBlock.state === State.NEW) {
            controlBlock.state = State.READY;
            this.readyQueue.push(this.allProcesses[pid]);
        }
    }

    for (var i = 0; i < domElements.length; ++i) {
        domElements[i].update();
    }
}

function Instruction() {
    if (this.constructor === Instruction) {
        throw new Error("Cannot instantiate abstract class!");
    }
}

Instruction.prototype.execute = function() {
    throw new Error("Abstract method!");
}

function Sleep(cycles) {
    this.cycles = cycles;
}

Sleep.prototype = Object.create(Instruction.prototype);
Sleep.prototype.constructor = Sleep;
Sleep.prototype.execute = function(process) {
    var registers = process.controlBlock.registers;
    if (registers.hasOwnProperty("sleep")) {
        if (registers.sleep) {
            --registers.sleep
        } else {
            delete registers.sleep;
            ++process.controlBlock.pc;
        }
    } else {
        registers.sleep = this.cycles - 1;
    }
}

function Fork() {}

Fork.prototype = Object.create(Instruction.prototype);
Fork.prototype.constructor = Fork;
Fork.prototype.execute = function(process) {
    var pid = counter++;
    var registers = JSON.parse(JSON.stringify(process.controlBlock.registers));
    process.controlBlock.registers.return = pid;
    registers.return = 0;
    var forkedControlBlock = new ControlBlock(pid, ++process.controlBlock.pc, State.NEW, registers);
    var process = new Process(forkedControlBlock, program);
    Computer.createProcess(process);
}

function Wait(pid) {
    this.pid = pid;
}

Wait.prototype = Object.create(Instruction.prototype);
Wait.prototype.constructor = Wait;
Wait.prototype.execute = function(process) {
    var waitProcess = Computer.allProcesses[this.pid];
    if (waitProcess) {
        var state = waitProcess.controlBlock.state;
        if (state === State.TERMINATED) {
            delete Computer.allProcesses[this.pid];
            ++process.controlBlock.pc;
        } else {
            process.wakeCondition = function() {
                var waitProcess = Computer.allProcesses[this.pid];
                return !waitProcess || waitProcess.controlBlock.state === State.TERMINATED;
            }
            Computer.blockProcess(process.controlBlock.pid);
        }
    } else {
        ++process.controlBlock.pc;
    }
}

function Jump(n) {
    this.n = n;
}

Jump.prototype = Object.create(Instruction.prototype);
Jump.prototype.constructor = Jump;
Jump.prototype.execute = function(process) {
    process.controlBlock.pc += this.n + 1;
}

function JumpIf(n, register) {
    Jump.call(this, n);
    this.register = register;
}

JumpIf.prototype = Object.create(Jump.prototype);
JumpIf.prototype.constructor = JumpIf;
JumpIf.prototype.execute = function(process) {
    if (process.controlBlock.registers[this.register]) {
        process.controlBlock.pc += this.n;
    }
    ++process.controlBlock.pc;
}

var domElements = [];

function ProcessDomElement(process) {
    this.process = process;

    this.root = document.createElement("div");
    this.root.className = "card m-2 flex-fill";
    
    var cardBody = document.createElement("div");
    cardBody.className = "card-body";

    this.pid = document.createElement("h5");
    this.pid.className = "card-title";

    this.state = document.createElement("p");
    this.state.className = "mb-0";

    this.pc = document.createElement("p");
    this.pc.className = "mb-0";

    this.root.appendChild(cardBody);
    cardBody.appendChild(this.pid);
    cardBody.appendChild(this.state);
    cardBody.appendChild(this.pc);
}

ProcessDomElement.prototype.update = function() {
    this.pid.textContent = "PID " + this.process.controlBlock.pid;
    this.state.textContent = "State: " + this.process.controlBlock.state;
    this.pc.textContent = "PC: " + this.process.controlBlock.pc;
}

window.onload = function() {
    Computer.cpus[0] = null;
    var program = [new Sleep(10)];
    var controlBlock = new ControlBlock(counter++, 0, State.NEW, {});
    var process = new Process(controlBlock, program);
    Computer.createProcess(process);
    
    var domElement = new ProcessDomElement(process);
    domElements.push(domElement);
    document.getElementById("processes").appendChild(domElement.root);
    domElement.update();
}
