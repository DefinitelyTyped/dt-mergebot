const r = require('request');

const authToken = process.env['AUTH_TOKEN'];
if (authToken === undefined) {
    throw new Error("Must set AUTH_TOKEN environment variable");
}

const headers = {
    "Authorization": `TOKEN ${authToken}`,
    "user-agent": "@RyanCavanaugh/dt-mergebot Projects Lister",
    "accept": "application/vnd.github.inertia-preview+json"
};

const projects = r('https://api.github.com/repos/DefinitelyTyped/DefinitelyTyped/projects', { headers }, (err, data) => {
    const body = JSON.parse(data.body);

        console.log(JSON.stringify(JSON.parse(data.body), undefined, 2));

    const names = body.map(p => p.name);
    const ids = body.map(p => p.id);

    next();

    function next() {
        if (names.length === 0) return;

        const name = names.pop();
        const id = ids.pop();

        const url = `https://api.github.com/projects/${id}/columns`;
        r(url, { headers }, (err, data) => {
            if (err) throw err;
            const cols = JSON.parse(data.body);

                console.log(JSON.stringify(JSON.parse(data.body), undefined, 2));

            console.log(`== Project ${name} (${id}) ==`);
            console.log("{");
            for (const c of cols) {
                console.log(`  \"${c.name}\": ${c.id},`);
            }
            console.log("}");

            next();
        });
    }
});
