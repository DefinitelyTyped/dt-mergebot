const NodeEnvironment = require('jest-environment-node');
module.exports = class extends NodeEnvironment {
    constructor(config) {
        super(config);
        this.global.AbortSignal = AbortSignal;
        this.global.Event = Event;
        this.global.EventTarget = EventTarget;
    }
}
