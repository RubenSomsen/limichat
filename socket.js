/* TODO:

API spam protection from abusive users

Queue (unpaid): should expire after hour? (just publish if paid while offline)

Pending messages (paid): should expire after a day? (just reset wait time when offline?)

webhook: backup check before expiry in case of webhook failure (e.g. being offline)
	(maybe fixed, always checking with API before publish)*/

const api = require('./api');
const db = require('./db');

var PORT = process.env.PORT || 3000;

const mustache = require('mustache');
const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const bodyParser = require('body-parser');

const EventEmitter = require('events');
const emitter = new EventEmitter();

const CHAR_LIMIT = 280;
const TIME_TO_ZERO = 1200; //seconds
const MIN_PRICE = 600;

var lastPrice = MIN_PRICE;
var lastTime = Date.now();

init();

// load in all the vars, check whether payments were made while offline, and go 
async function init()
{
	const lastPublished = await db.getQuery(...db.query.lastPublished);

	if(lastPublished)
	{  
		lastPrice = lastPublished.amount;
		lastTime = lastPublished.time;
	}
	
	keepUpdatingPrice();

	io.on('connection', socketConnect);
	
	function socketConnect(socket)
	{
		if(api.TESTNET) { console.log(socket.id + ' connected ' + socket.handshake.address); }

		socket.on('chat message', msg => createInvoiceAndPublish(msg, socket));

		socket.on('disconnect', () => { if(api.TESTNET) { console.log(socket.id + ' disconnected') }});
	}

	app.get('/', (req, res) => { 
		var rData = { records : db.store.chat }; // wrap the data in a global object... (mustache starts from an object then parses)
		var page = db.fs.readFileSync("index.html", "utf8"); // bring in the HTML file
		var html = mustache.to_html(page, rData); // replace all of the data
		res.send(html); // send to client
});
	app.use(bodyParser.urlencoded({ extended: false }));
	app.post('/webhook', (req, res) => emitter.emit(req.body.id));

	app.use(express.static('public'));

	http.listen(PORT, () => { if(api.TESTNET) { console.log('listening to ' + PORT)}});

	const invoices = await db.initUnpaidInvoices();

	for(i in invoices)
	{
		var invoice = invoices[i];
		if(api.WEBHOOK) 
		{ 
			var check = await api.checkStatus(invoice); // TODO: var not needed?
			if(!check) 
			{
				emitter.once(invoice.id, () => publishOnPayment(invoice)); 
			}
			else { publishOnPayment(invoice); }
		}
		else {publishOnPayment(invoice); }
	}
}

// use this to calculate current price
function getPrice(time = Date.now())
{
	var timePassed = (time-lastTime) / (api.TESTNET ? 10000 : 1000); // in seconds
		timePassed = timePassed > TIME_TO_ZERO ? TIME_TO_ZERO : timePassed; // cut off at 20 minutes (1200 seconds)
		
	var price = Math.round(1 + (1 - timePassed / TIME_TO_ZERO) * (lastPrice*2)); // down to 1 sat after 20 min
		price = price < MIN_PRICE ? MIN_PRICE : price; // capped at 600 sats

	return price;
}

// use this to set a new price
function setPrice(time = Date.now())
{
	lastPrice = getPrice(time);
	lastTime = time;
}

// create invoice, publish as soon as it has been paid
async function createInvoiceAndPublish(description, socket)
{
	if(api.TESTNET) { console.log('message: ' + description) }
	if (description.length > CHAR_LIMIT) { return; }

	var equal = await db.getEqualMessage("paid", description);
	var discount = equal ? equal.amount : 0;

	var invoice = await api.createInvoice(getPrice() - discount, "BTC", description);

	invoice.status = "unpaid";
	db.updateInvoice(invoice);
	
	socket.emit('chat message2', "<b>In order to display</b> \"" + db.escapeHtml(description) + "\" <b>you should send " + invoice.amount + " satoshis to:</b><i> " + invoice.address + "</i>");
	//socket.emit('goto link', 'lightning:' + invoice.address); // TODO: make sending payment URI link optional

	// if WEBHOOK, publish on event
	if(api.WEBHOOK) { return emitter.once(invoice.id, () => { 
		publishOnPayment(invoice, socket, discount);
	}); }

	return publishOnPayment(invoice, socket, discount);
}

// TODO
async function publishOnPayment(invoice, socket = null, discount = 0)
{
	var check = await api.awaitPayment(invoice); // TODO: remove var?

	if(!check) { return; }

	invoice.status = "paid";

	if(invoice.amount < getPrice() - discount && socket !== null)
	{
		socket.emit('chat message2', "<b>Sorry, someone beat you to it! Message</b> \"" + db.escapeHtml(invoice.description) + "\" <b>is now in the queue and will display as soon as your payment passes the threshold. You can increase your payment by resubmitting the EXACT same message and paying the difference.</b>");	
	}
	return queueMessage(invoice);//{description : invoice.description, amount: invoice.amount });
}

async function queueMessage(invoice)
{
	var equal = await db.getEqualMessage("paid", invoice.description);

	if(equal)
	{
		invoice.status = "merged";
		await db.updateInvoice(invoice);
		invoice.status = "paid"; // TODO: a little messy, maybe switch invoice for equal
		invoice.amount += equal.amount;
		invoice.id = equal.id;
	}

	invoice.time = Date.now();

	await db.updateInvoice(invoice);

	return;
}

async function pushMessage(invoice)
{
	invoice.time = Date.now();
	invoice.status = "published";
	db.updateInvoice(invoice);
	io.emit('chat message', invoice.description);
	setPrice(invoice.time);
}

async function keepUpdatingPrice(delay = 1000)
{
	var amount = getPrice();

	await new Promise(resolve => setTimeout(resolve, delay));
	io.emit('button update', amount + ' sat');

	var topQueued = await db.getQuery(...db.query.topQueued);

	if(topQueued)
	{
		if(topQueued.amount >= amount)
		{
			pushMessage(topQueued);
		}
	}

	return keepUpdatingPrice(delay);
}