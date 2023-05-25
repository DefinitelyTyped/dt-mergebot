// @ts-check
const fs = require('fs')
const args = process.argv.slice(2)
for (const arg of args) {
    const original = JSON.parse(fs.readFileSync(arg, 'utf8'))
    const updated = {}
    for (const k in original) {
        if (original[k].length === 0) {
            console.log(arg, 'skipping empty file', k)
            updated[k.replace(/index\.d\.ts$/, 'package.json')] = ""
            continue
        }
        const filenameMatch = /types\/(.*?)\/index\.d\.ts/.exec(k)
        if (!filenameMatch) {
            console.log(arg, 'index.d.ts not found in', k)
            updated[k] = original[k]
            continue
        }
        const name = "@types/" + filenameMatch[1]
        const versionMatch = / Type definitions for .+? v?(\d+\.\d+)/.exec(original[k])
        const version = (versionMatch ? versionMatch[1] : "1.0") + ".99999"
        if (!versionMatch) {
            console.log(arg, "No version found for", name)
        }
        const projectMatch = / Project: ([^\n]+)/.exec(original[k])
        const projects = projectMatch ? [projectMatch[1]] : []
        if (!projectMatch) {
            console.log(arg, "No project found for", name)
        }
        const contributors = []
        let m;
        const re = / +([^:]+?) <https:\/\/github.com\/(.+?)>/gm
        while ((m = re.exec(original[k])) !== null) {
            contributors.push({ name: m[1], githubUsername: m[2] })
        }
        updated[k.replace(/index\.d\.ts$/, 'package.json')] = JSON.stringify({
            private: true,
            name,
            version,
            projects,
            devDependencies: {
                [name]: "workspace:."
            },
            contributors })
    }
    fs.writeFileSync(arg, JSON.stringify(updated, null, 2))
}
