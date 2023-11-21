/**
 * Import node modules
 */

const express = require("express");
const http = require("http");
const path = require("path");
const app = express();
const bodyParser = require("body-parser");
const { MongoClient, ServerApiVersion } = require('mongodb');
const { lookup } = require("dns");
const fetch = require("node-fetch")
require("dotenv").config({ path: path.resolve(__dirname, 'credentialsDontPost/.env') });

/**
 * App setup
 */
app.set("views", path.resolve(__dirname, "templates"));
app.set("view engine", "ejs");
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({extended:false}));

/**
 * MongoDB setup
 */
const userName = process.env.MONGO_DB_USERNAME;
const password = process.env.MONGO_DB_PASSWORD;
const db_name = process.env.MONGO_DB_NAME;
const lookup_collection = process.env.LOOKUPS;
const player_collection = process.env.PLAYERS;
const databaseAndCollection = {db: `${db_name}`, lookups: `${lookup_collection}`, players: `${player_collection}`};
const uri = `mongodb+srv://${userName}:${password}@cluster0.elf9uhi.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

/**
 * Setup Player IDs for lookups
 */
async function getPlayerIDs() {
    const result = await fetch(
        "https://sports.core.api.espn.com/v3/sports/football/nfl/athletes?limit=20000&active=true"
    ).then(response => response.json());
    
    for (let player of result.items) {
        if (player.active === true) {
            insertID(player.id, player.firstName, player.lastName);
        }
    }
}

async function insertID(id_in, fn_in, ln_in) {
    try {
        await client.connect();
        const result = await client.db(databaseAndCollection.db).collection(databaseAndCollection.players).updateOne(
            {id: id_in},
            {$set: {id: id_in, firstname: fn_in, lastname: ln_in}},
            {upsert: true}
        );
    } catch (e) {
        console.error(e);
    }
}
//removeAllIDs();
//removeAllLookups();
getPlayerIDs();

/**
 * Handling routing for app
 */
app.get("/", (req, res) => {
    res.render("index");
});

app.get("/lookup", (req, res) => {
    res.render("lookup");
});

app.post("/lookup-result", async (req, res) => {
    let {firstname, lastname} = req.body;
    let result = await lookupPlayer(firstname, lastname);
    const vars = {
        firstname: result.firstname,
        lastname: result.lastname,
        passtable: result.pass,
        rushtable: result.rush,
        rectable: result.rec
    }
    res.render("result", vars);
});

app.listen(5000);
console.log(`http://localhost:5000`);


/**
 * Player Lookup function.
 * @param {*} firstname 
 * @param {*} lastname 
 * @returns 
 */
async function lookupPlayer(firstname, lastname) {
    const filter = {firstname: firstname.trim(), lastname: lastname.trim()};
    const check = await client.db(databaseAndCollection.db)
                            .collection(databaseAndCollection.lookups)
                            .findOne(filter);
    if (check) {
        let passtable = `<table border=1 class="tables"><tr><th>Season</th><th>Yards</th><th>TDs</th></tr><tr><td>2022</td><td>${check["Passing"]["Yards"]}</td><td>${check["Passing"]["TDs"]}</td></tr></table>`;
        let rushtable = `<table border=1 class="tables"><tr><th>Season</th><th>Yards</th><th>TDs</th></tr><tr><td>2022</td><td>${check["Rushing"]["Yards"]}</td><td>${check["Rushing"]["TDs"]}</td></tr></table>`;
        let rectable = `<table border=1 class="tables"><tr><th>Season</th><th>Yards</th><th>TDs</th></tr><tr><td>2022</td><td>${check["Receiving"]["Yards"]}</td><td>${check["Receiving"]["TDs"]}</td></tr></table>`;
        
        return {firstname: firstname, lastname: lastname, pass: passtable, rush: rushtable, rec: rectable};
    } else {
        const result = await client.db(databaseAndCollection.db)
                            .collection(databaseAndCollection.players)
                            .findOne(filter);
        if (result) {
            let url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes/${result.id}/statisticslog`
            
            const stats = await fetch(url)
                                .then(response => response.json())
                                .then(response => response.entries[0].statistics[1].statistics.$ref)
                                .then(response => fetch(response))
                                .then(response => response.json())
                                .then(response => response.splits.categories);
            
            let lookup = {};
            let pass = {};
            let rush = {};
            let rec = {};
            
            for (let s of stats) {
                if (s.name === "passing") {
                    console.log(s.stats);
                    for (let s2 of s.stats) {
                        if (s2.name === "passingYards") {
                            pass["Yards"] = s2.value;
                        } else if (s2.name === "passingTouchdowns") {
                            pass["TDs"] = s2.value;
                        } else if (s2.name === "interceptions") {
                            pass["INTs"] = s2.value;
                        } else if (s2.name === "twoPtPass") {
                            pass["2PTs"] = s2.value;
                        }
                    }
                }

                if (s.name === "rushing") {
                    for (let s2 of s.stats) {
                        if (s2.name === "rushingYards") {
                            rush["Yards"] = s2.value;
                        } else if (s2.name === "rushingTouchdowns") {
                            rush["TDs"] = s2.value;
                        }
                    }
                }

                if (s.name === "receiving") {
                    for (let s2 of s.stats) {
                        if (s2.name === "receivingYards") {
                            rec["Yards"] = s2.value;
                        } else if (s2.name === "receivingTouchdowns") {
                            rec["TDs"] = s2.value;
                        }
                    }
                }
            }
            lookup["id"] = result.id;
            lookup["firstname"] = firstname;
            lookup["lastname"] = lastname;
            lookup["Passing"] = pass;
            lookup["Rushing"] = rush;
            lookup["Receiving"] = rec;

            const add = await client.db(databaseAndCollection.db).collection(databaseAndCollection.lookups).updateOne(
                { "id": lookup.id, "firstname": lookup.firstname, "lastname": lookup.lastname },
                { $set: { "id": lookup.id, "firstname": lookup.firstname, "lastname": lookup.lastname, "Passing": lookup.Passing, "Rushing": lookup.Rushing, "Receiving": lookup.Receiving}},
                { upsert: true }
            );
            
            let passtable = `<table border=1 class="tables">
                                <tr><th>Season</th><th>Yards</th><th>TDs</th></tr>
                                <tr><td>2022</td><td>${lookup["Passing"]["Yards"]}</td><td>${lookup["Passing"]["TDs"]}</td></tr>
                                </table>`;
            let rushtable = `<table border=1 class="tables">
                                <tr><th>Season</th><th>Yards</th><th>TDs</th></tr>
                                <tr><td>2022</td><td>${lookup["Rushing"]["Yards"]}</td><td>${lookup["Rushing"]["TDs"]}</td></tr>
                            </table>`;
            let rectable = `<table border=1 class="tables">
                                <tr><th>Season</th><th>Yards</th><th>TDs</th></tr>
                                <tr><td>2022</td><td>${lookup["Receiving"]["Yards"]}</td><td>${lookup["Receiving"]["TDs"]}</td></tr>
                            </table>`;
            
            return {firstname: firstname, lastname: lastname, pass: passtable, rush: rushtable, rec: rectable};
        } else {
            let passtable = `<table border=1 class="tables"><tr><th>Season</th><th>Yards</th><th>TDs</th></tr></table>`;
            let rushtable = `<table border=1 class="tables"><tr><th>Season</th><th>Yards</th><th>TDs</th></tr></table>`;
            let rectable = `<table border=1 class="tables"><tr><th>Season</th><th>Yards</th><th>TDs</th></tr></table>`;
            
            return {firstname: firstname, lastname: lastname, pass: passtable, rush: rushtable, rec: rectable};
        }
    }
}


async function removeAllIDs() {
    try {
        await client.connect();
        const result = await client.db(databaseAndCollection.db)
        .collection(databaseAndCollection.players)
        .deleteMany({});
        let num = result.deletedCount;
        return num;
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

async function removeAllLookups() {
    try {
        await client.connect();
        const result = await client.db(databaseAndCollection.db)
        .collection(databaseAndCollection.lookups)
        .deleteMany({});
        let num = result.deletedCount;
        return num;
    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}
