// eslint-disable-next-line @typescript-eslint/no-var-requires
const jestEnvNode = require("jest-environment-node");
module.exports = class extends jestEnvNode.TestEnvironment {
    constructor(config) {
        super(config);
        this.global.AbortSignal = AbortSignal;
        this.global.Event = Event;
        this.global.EventTarget = EventTarget;
    }
};
