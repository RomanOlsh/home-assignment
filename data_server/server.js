const express = require('express');
const app = express();
let counter = 1;
let port = process.env.PORT || 8080;

app.get('/', function (_, res) {
    if (counter % 4 == 0) {
        res.status(401).send("Not this time...");
    } else {
        res.status(200).send("OK");
    }
    counter++;
});

server = app.listen(port, () => console.log("App listening on port: " + port));