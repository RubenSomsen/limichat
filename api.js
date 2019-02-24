const fetch = require('node-fetch');
const ratelimit = require('promise-ratelimit')(1000);

const TESTNET = true;
const WEBHOOK = true; // TODO: Useless? May need non-webhook functionality?

// CONFIG: Mid level API key (read-only), get your own (testnet) key at (dev.)opennode.co
const API_KEY = TESTNET ? "[INSERT TESTNET API KEY]" : "[INSERT MAINNET API KEY]";
const OPENNODE_API = "https://" + (TESTNET ? "dev-" : "") + "api.opennode.co/v1";
const ID_SITE = "https://" + (TESTNET ? "dev-" : "") + "checkout.opennode.co/";
const callback_url = "https://" + (TESTNET ? "f13a5c5f.ngrok.io" : "limichat.herokuapp.com") + "/webhook";

async function init()
{
	// TODO: Useless? May need to receive info from DB?
}

// General function that fetches data from the API
async function getData(url, body)
{
	await ratelimit();

	var headers = {'Content-Type': 'application/json', 'Authorization': API_KEY};
	var method = body === undefined ? 'GET' : 'POST';
	var request = { method, body: JSON.stringify(body), headers };
	
	var result = await fetch(OPENNODE_API + url, request);
		result = await result.json();
	
	return result.data;
}

// Creates invoices of a certain amount (USD by default), and a Lightning address
async function createInvoice(amount, currency = "USD", description = "")
{
	var invoice = { amount, currency, description, callback_url };
	var result = await getData('/charges', invoice);

	invoice.testnet = TESTNET;
	invoice.id = result.id;
	invoice.address = result.lightning_invoice.payreq;
	invoice.time = Date.now();

	if(TESTNET) { console.log("Invoice:\n" + ID_SITE + invoice.id) }
	if(TESTNET) { console.log("Payment address:\n" + invoice.address) }

	return invoice;
}

// Returns true if a specific invoice has been paid
async function checkStatus(invoice)
{
	invoice = await invoice;

	var result = await getData('/charge/' + invoice.id);

	return result.status === "paid";
}

// Keeps looping until a specific invoice has been paid
async function awaitPayment(invoice)
{
	if(await checkStatus(invoice))
	{
		if(TESTNET) { console.log("Invoice paid!") }
		return true;
	}
	if(WEBHOOK) {return false}; // TODO: Is this needed?
	return awaitPayment(invoice);
}

//awaitPayment(createInvoice(1,"USD","Pay $1"));

module.exports = { createInvoice, checkStatus, awaitPayment, WEBHOOK, TESTNET }