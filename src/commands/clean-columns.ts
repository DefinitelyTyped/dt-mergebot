import fs = require('fs');
import path = require('path');
import request = require('request');

type Result = {
    data: {
        repository: {
            project: {
                columns: {
                    edges: Array<{
                        node: {
                            cards: {
                                edges: Array<{
                                    node: {
                                        databaseId: number;
                                        content: {
                                            state: "OPEN" | "MERGED" | "CLOSED";
                                            number: number;
                                        };
                                    };
                                }>;
                            };
                        };
                    }>;
                };
            };
        };
    };
};

const headers = {
    "User-Agent": "RyanCavanaugh ColumnCleaner",
    "Authorization": `token ${process.env['AUTH_TOKEN']}`,
    "Accept": "application/vnd.github.inertia-preview+json"
}


let cleanCount = 0;
fs.readFile(path.join(__dirname, '../clean-columns-query.graphql'), { encoding: 'utf-8' }, (err, query) => {
    if (err) throw err;

    request.post('https://api.github.com/graphql', {
        body: JSON.stringify({ query }),
        headers
    }, (err, data) => {
        if (err) throw err;
        const result: Result = JSON.parse(data.body);
        for (const column of result.data.repository.project.columns.edges) {
            for (const card of column.node.cards.edges.map(c => c.node)) {
                if (card.content.state !== 'OPEN') {
                    cleanCount++;
                    request.delete(`https://api.github.com/projects/columns/cards/${card.databaseId}`, { headers }, (err, _unused) => {
                        if (err) throw err;
                    });
                }
            }
        }
        console.log(`Cleaned ${cleanCount} cards from the backlog project`);
    });
});
