const process = require("process");
const fs = require("fs");
const path = require("path");

const dir = process.argv[2] || ".";

const getTree = (name, isdir) =>
  ({ name: path.basename(name),
     subs: !isdir ? null
           : fs.readdirSync(name, { withFileTypes: true })
               .map(p => getTree(path.join(name, p.name), p.isDirectory()))
   });

const flatten = xs => [].concat(...xs);
const mapLast = (a, f) => a.map((x, i) => f(x, i === a.length-1 ? 1 : 0));

const indents = [ "|   ", "    ", "+-- ", "\\-- " ];

const printTree = (tree, indent) =>
  [[...mapLast(indent, (i, last) => indents[i + 2*last]), tree.name, !tree.subs ? "" : "/"],
   ...!tree.subs ? [] : flatten(mapLast(tree.subs, (t, last) => printTree(t, [...indent, last])))];

printTree(getTree(dir, true), []).forEach(line => console.log(line.join("")));
