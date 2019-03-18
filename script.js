"use strict";

var State = Object.freeze({
    NEW: "NEW",
    READY: "READY",
    RUNNING: "RUNNING",
    WAITING: "WAITING",
    TERMINATED: "TERMINATED"
});

function Registers() {
    this.eax = 0;
    this.ebx = 0;
    this.eip = 0;
    this.zf = false;
}

function Program(instructions, labels) {
    this.instructions = instructions;
    this.labels = labels;
}

function Process(pid, ppid, program) {
    this.pid = pid;
    this.ppid = ppid;
    this.program = program;
    this.state = State.NEW;
    this.registers = new Registers();
}

function Subtract(l, r) {
    this.l = l;
    this.r = r;
}

Subtract.prototype.execute = function(process) {
    var r = isNaN(this.r) ? process.registers[this.r] : parseInt(this.r);
    process.registers[this.l] -= r;
    process.registers.zf = process.registers[this.l] === 0;
};

function Move(l, r) {
    this.l = l;
    this.r = r;
}

Move.prototype.execute = function(process) {
    process.registers[this.l] = isNaN(this.r) ? process.registers[this.r] : parseInt(this.r);
};

function Jump(label) {
    this.label = label;
}

Jump.prototype.execute = function(process) {
    process.registers.eip = process.program.labels[this.label];
};

function JumpIfEqual(label) {
    this.label = label;
}

JumpIfEqual.prototype.execute = function(process) {
    if (process.registers.zf) {
        process.registers.eip = process.program.labels[this.label];
    }
};

function JumpIfNotEqual(label) {
    this.label = label;
}

JumpIfNotEqual.prototype.execute = function(process) {
    if (!process.registers.zf) {
        process.registers.eip = process.program.labels[this.label];
    }
};

function Call(closure) {
    this.closure = closure;
}

Call.prototype.execute = function(process) {
    this.closure(process.pid);
};

function Computer() {
    this.pidCounter = 2;
    this.cpus = {};
    this.queue = [];

    var self = this;
    var initProgram = new Program([
        new Move("ebx", -1),
        new Call(function(pid) {self.waitpid(pid)}),
        new Jump("begin")
    ], {"begin": 1});
    var initProcess = new Process(1, 0, initProgram);
    this.processes = {1: initProcess};

    // TODO: REMOVE
    var processDomElement = new ProcessDomElement(initProcess);
    domElements.push(processDomElement);
}

Computer.prototype.reap = function(pid) {
    var process = this.processes[pid];
    for (var pid in this.processes) {
        if (this.processes[pid].ppid === process.pid) {
            this.processes[pid].ppid = 1;
        }
    }
    delete this.processes[pid];
};

Computer.prototype.doWait = function(pid) {
    var process = this.processes[pid];
    for (var cpu in this.cpus) {
        if (this.cpus[cpu] && this.cpus[cpu].pid === pid) {
            this.cpus[pid] = null;
            break;
        }
    }
    process.state = State.WAITING;
};

Computer.prototype.fork = function(pid) {
    var originalProcess = this.processes[pid];
    var forkedProcess = new Process(this.pidCounter++, pid, originalProcess.program);
    originalProcess.registers.eax = forkedProcess.pid;
    forkedProcess.registers = JSON.parse(JSON.stringify(originalProcess.registers));
    forkedProcess.registers.eax = 0;
    this.processes[forkedProcess.pid] = forkedProcess;
};

Computer.prototype.waitpid = function(pid) {
    var process = this.processes[pid];
    var arg = process.registers.ebx;
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
        process.registers.eax = -1;
    } else {
        for (var i in children) {
            var child = this.processes[children[i]];
            if (child.state === State.TERMINATED) {
                process.registers.eax = child.pid;
                this.reap(child.pid);
                return;
            }
        }
        var onTerminated = function(pid) {
            children.forEach(function(child) {
                delete child.onTerminated;
            });
            process.registers.eax = pid;
            self.reap(pid);
            self.processes[process.pid].state = State.READY;
        };
        children.forEach(function(pid) {
            self.processes[pid].onTerminated = function() {
                onTerminated(pid);
            }
        });
        this.doWait(pid);
    }
};

Computer.prototype.doCycle = function() {
    var process;
    for (var pid in this.processes) {
        process = this.processes[pid];
        if (!process.inQueue && !process.inCpu && [State.READY, State.NEW].indexOf(process.state) !== -1) {
            this.queue.push(process);
            process.inQueue = true;
        }
    }

    for (var cpu in this.cpus) {
        process = this.cpus[cpu];
        if (process) {
            if (process.state === State.NEW) {
                process.state = State.RUNNING;
            } else {
                process.program.instructions[process.registers.eip++].execute(process);
                if (process.registers.eip === process.program.instructions.length) {
                    process.state = State.TERMINATED;
                    this.cpus[cpu] = null;
                }
            }
        }
        if (!this.cpus[cpu] && this.queue.length > 0) {
            process = this.queue.splice(0, 1)[0];
            process.inQueue = false;
            this.cpus[cpu] = process;
            process.inCpu = true;
            if (process.state === State.READY) {
                process.state = State.RUNNING;
            }
        }
    }

    domElements.forEach(function(domElement) {domElement.update()});
};

// TODO: WIP
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

    this.eax = document.createElement("p");
    this.eax.className = "mb-0";

    this.ebx = document.createElement("p");
    this.ebx.className = "mb-0";

    this.eip = document.createElement("p");
    this.eip.className = "mb-0";

    this.root.appendChild(cardBody);
    cardBody.appendChild(this.pid);
    cardBody.appendChild(this.state);
    cardBody.appendChild(this.eax);
    cardBody.appendChild(this.ebx);
    cardBody.appendChild(this.eip);
}

ProcessDomElement.prototype.update = function() {
    this.pid.textContent = "PID " + this.process.pid + " PPID " + this.process.ppid;
    this.state.textContent = "State: " + this.process.state;
    this.eax.textContent = "eax: " + this.process.registers.eax;
    this.ebx.textContent = "ebx: " + this.process.registers.ebx;
    this.eip.textContent = "eip: " + this.process.registers.eip;
    document.getElementById("processes").appendChild(this.root);
};

var computer = new Computer();

function doCycle() {
    computer.doCycle();
    setTimeout(function() {
        doCycle();
    }, 1000);
}

window.onload = function() {
    computer.cpus[0] = null;
    /*
    var program = [new Sleep(10)];
    var controlBlock = new ControlBlock(counter++, 0, State.NEW, {});
    var process = new Process(controlBlock, program);
    Computer.createProcess(process);
    */
    
    //var domElement = new ProcessDomElement(process);
    //domElements.push(domElement);
    //document.getElementById("processes").appendChild(domElement.root);
    //domElement.update();
    document.getElementById("processes").innerHTML = "";
    domElements.forEach(function(domElement) {domElement.update()});

    doCycle();
};
