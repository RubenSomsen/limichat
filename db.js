const fs = require('fs-extra');
const firebase = require("firebase");

const db = initFireBase();

const store = {};

const query = {
    topQueued : ["paid", "amount", "desc"],
    lastPublished : ["published", "time", "desc"]/*,
    oldestQueued : ["paid", "time", "asc"],
    oldestUnpaid : ["unpaid", "time", "asc"]*/
}

const escapeHtml = s => s.replace(/[^0-9A-Za-z ]/g, c => "&#" + c.charCodeAt(0) + ";");

function initFireBase()
{
    // CONFIG: API key and related info goes here
    const config = {
        apiKey: "",
        authDomain: "",
        databaseURL: "",
        projectId: "",
        storageBucket: ""
    };

    firebase.initializeApp(config);

    const firestore = firebase.firestore();
    firestore.settings({timestampsInSnapshots: true});

    return firestore.collection("invoices");
}

async function init()
{
    await initChatHistory();
    
    //var var3 = {id: 8, status: "paid", amount: 8, time: 8}; // TODO: Potential bug? what happens if amount increases?
}

async function initChatHistory()
{
    store.chat = [];
    fs.writeFile("public/chat.txt", "");
    const q = await db.where("status", "==", "published").orderBy("time", "asc").get();
    q.forEach(doc => addChatMessage(doc.data().description));

    return store.chat;
}

async function initUnpaidInvoices()
{
    var invoices = [];
    const q = await db.where("status", "==", "unpaid").orderBy("time", "asc").get();
    q.forEach(doc => invoices.push(doc.data()));

    return invoices;
}

async function addChatMessage(description)
{
    store.chat.push(description);
    fs.appendFile("public/chat.txt", "<li>" + escapeHtml(description) + "</li>" + "\n");
}

init();

async function updateInvoice(invoice)
{    
    Object.keys(query).forEach(async (key) => await checkQuery(invoice, ...query[key]));

    // assumes publish happens only once (no more changes) without check
    if(invoice.status === "published") { addChatMessage(invoice.description); }
    
    await db.doc(invoice.id.toString()).set(invoice);
}

async function checkQuery(invoice, status, orderBy, direction)
{
    const memo = status + orderBy + direction;
    const paid = invoice.status === status;
    const get = await getQuery(status, orderBy, direction);

    const compare = (a,b,o) => direction === "desc" ? a[o] < b[o] : b[o] > a[o];

    if(get && get.id === invoice.id && !paid) { store[memo] = undefined; }
    else if((!get || compare(get, invoice, orderBy)) && paid) { store[memo] = invoice; }
    
    return store[memo];
}

async function getQuery(status, orderBy, direction) 
{
    const memo = status + orderBy + direction;
    if(store[memo] !== undefined) { return store[memo]; }

    store[memo] = await db.where("status", "==", status).orderBy(orderBy, direction).limit(1).get();
    store[memo] = store[memo].empty ? null : await store[memo].docs[0].data();

    return store[memo];
}

async function getEqualMessage(status, description) // TODO: status always unpaid?
{
    var invoice = await db.where("status", "==", status).where("description", "==", description).limit(1).get();
    invoice = invoice.empty ? null : await invoice.docs[0].data();

    return invoice;
}

module.exports = { updateInvoice, query, getQuery, initUnpaidInvoices, getEqualMessage, escapeHtml, store, fs };