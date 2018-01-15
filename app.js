var express = require('express')
var request = require('request')
var MiningRigRentalsAPI = require('miningrigrentals-api')
var sqlite3 = require('sqlite3').verbose()
var fs = require('fs')
var readlineSync = require('readline-sync')
var app = express()
var bodyParser = require('body-parser')
var EventEmitter = require('eventemitter3')
app.use(bodyParser.json()) // support json encoded bodies
app.use(bodyParser.urlencoded({extended: true})) // support encoded bodies
app.use(express.static(__dirname + '/static')); // Include the autominer-frontend repository as the static


var dbfile = __dirname + '/autominer.db'
var exists = fs.existsSync(dbfile)
var db = new sqlite3.Database(dbfile)

var installed = true;
var installStepTwo = false;

var enable_API = false;

db.serialize(function () {
	if (!exists) {
		// Create the logs table
		db.run('CREATE TABLE log (id INTEGER PRIMARY KEY NOT NULL, timestamp INTEGER NOT NULL, type VARCHAR NOT NULL, message VARCHAR NOT NULL, extrainfo VARCHAR);')
		db.run('CREATE TABLE balance (id INTEGER PRIMARY KEY NOT NULL, timestamp INTEGER NOT NULL, type VARCHAR NOT NULL, amount INTEGER NOT NULL, extrainfo VARCHAR);')
		db.run('CREATE TABLE rentals (id INTEGER PRIMARY KEY NOT NULL, timestamp INTEGER NOT NULL, type VARCHAR NOT NULL, response INTEGER NOT NULL, extrainfo VARCHAR);')
	}
})

// Set the default calculations
var calculations = {
	'status': "Starting up...",
	'pool_max_margin': 20,
	'flo_difficulty': 0,
	'pool_hashrate': 0,
	'fbd_networkhashps': 0,
	'MiningRigRentals_last10': 0,
	'fmd_weighted_btc': 0,
	'fmd_weighted_usd': 0,
	'flo_spotcost_btc': 0,
	'flo_spotcost_usd': 0,
	'pool_influence': 0,
	'pool_influence_code': -1,
	'pool_influence_multiplier': -1,
	'market_conditions': 0,
	'market_conditions_code': -1,
	'market_conditions_multiplier': -1,
	'pool_margin': 0,
	'offer_btc': 0
}

var settings;
var MRRAPI = null;


// Add headers
app.use(function (req, res, next) {

	// Website you wish to allow to connect
	res.setHeader('Access-Control-Allow-Origin', '*')

	// Request methods you wish to allow
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE')

	// Request headers you wish to allow
	res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type')

	// Set to true if you need the website to include cookies in the requests sent
	// to the API (e.g. in case you use sessions)
	res.setHeader('Access-Control-Allow-Credentials', true)

	// Pass to next layer of middleware
	next()
})

app.get('/info', function (req, res) {
	if (!enable_API){
		return res.send("API Not Enabled.")
	}
	var pretty = calculations
	pretty['pool_hashrate'] = parseFloat(pretty['pool_hashrate'].toFixed(0))
	pretty['flo_spotcost_btc'] = parseFloat(pretty['flo_spotcost_btc'].toFixed(8))
	pretty['flo_spotcost_usd'] = parseFloat(pretty['flo_spotcost_usd'].toFixed(8))
	pretty['market_conditions'] = parseFloat(pretty['market_conditions'].toFixed(8))
	pretty['offer_btc'] = parseFloat(pretty['offer_btc'].toFixed(8))

	res.send(pretty)
})

app.post('/install', function (req, res) {
	if (!enable_API){
		return res.send("API Not Enabled.")
	}
	if (!installed){
		if (req.body){
			var data = fs.readFileSync(__dirname + '/settings.example.cfg');

			settings = JSON.parse(data);

			for (var key in req.body) {
				if (req.body.hasOwnProperty(key)) {
					if (isNaN(req.body[key])) {
						if (req.body[key] === 'false')
							settings[key] = false
						else if (req.body[key] === 'true')
							settings[key] = true
						else
							settings[key] = req.body[key]
					} else {
						settings[key] = parseFloat(req.body[key])
					}
				}
			}

			saveConfig();
			installed = true;
			installStepTwo = true;

			res.send('{"success":true,"message":"Step one of install complete, please move on to step 2!"}')
		}
	} else {
		res.send('{"success":false,"message":"You cannot install when you are already installed!"}')
	}
	
})

app.get('/install2', function (req, res){
	if (!enable_API){
		return res.send("API Not Enabled.")
	}
	if (installStepTwo){
		if (MRRAPI === null) {
			MRRAPI = new MiningRigRentalsAPI(settings.MRR_API_key, settings.MRR_API_secret)
		}

		updateProfiles(function(profiles){
			res.send('{"success":true,"data":"' + JSON.stringify(settings.profiles) + '"}');
		});
	} else {
		res.send('{"success":false,"message":"Not in install mode!"}')
	}
})

app.post('/install2', function (req, res) {
	if (!enable_API){
		return res.send("API Not Enabled.")
	}
	if (installStepTwo){
		if (req.body){
			for (var key in req.body) {
				if (req.body.hasOwnProperty(key)) {
					if (isNaN(req.body[key])) {
						if (req.body[key] === 'false')
							settings[key] = false
						else if (req.body[key] === 'true')
							settings[key] = true
						else
							settings[key] = req.body[key]
					} else {
						settings[key] = parseFloat(req.body[key])
					}
				}
			}

			saveConfig();
			installed = true;
			installStepTwo = false;

			res.send('{"success":true,"message":"Install Complete!"}')
		}
	} else {
		res.send('{"success":false,"message":"You cannot install when you are already installed!"}')
	}
	
})

app.post('/config', function (req, res) {
	if (!enable_API){
		return res.send("API Not Enabled.")
	}
	if (req.body.api_key && req.body['api_key'] === settings['api_key']) {
		for (var key in req.body) {
			if (req.body.hasOwnProperty(key))
				if (key !== 'api_key') {
					if (isNaN(req.body[key])) {
						if (req.body[key] === 'false')
							settings[key] = false
						else if (req.body[key] === 'true')
							settings[key] = true
						else
							settings[key] = req.body[key]
					}
					else
						settings[key] = parseFloat(req.body[key])
				}
		}
		saveConfig()

		var tmpSets = JSON.parse(JSON.stringify(settings))
		delete tmpSets.api_key
		res.send(tmpSets)
	}
	else
		res.send('{"success":false,"message":"Incorrect API Key"}')
})

app.post('/logs', function (req, res) {
	if (!enable_API){
		return res.send("API Not Enabled.")
	}
	if (req.body.api_key && req.body['api_key'] === settings['api_key'])
		if (req.body.amount) {
			getLogs(req.body.amount, function (err, logs) {
				res.send(logs)
			})
		} else {
			// Default to returning the last 50 logs
			getLogs(50, function (err, logs) {
				res.send(logs)
			})
		}
	else {
		console.log(req.body)
		res.send('{"success":false,"message":"Incorrect API Key"}')
	}
})

app.post('/rentals', function (req, res) {
	if (!enable_API){
		return res.send("API Not Enabled.")
	}
	if (req.body.api_key && req.body['api_key'] === settings['api_key'])
		if (req.body.amount) {
			getRentals(req.body.amount, function (err, logs) {
				res.send(logs)
			})
		} else {
			// Default to returning the last 50 logs
			getRentals(50, function (err, logs) {
				res.send(logs)
			})
		}
	else {
		console.log(req.body)
		res.send('{"success":false,"message":"Incorrect API Key"}')
	}
})

var alexandriaPool = false
var florincoinInfo = false
var miningRigs = false
var libraryd = false

function updateEnpointData () {
	// Request data async from each endpoint. When all four have been queried then update the calculations.
	alexandriaPool = false
	florincoinInfo = false
	miningRigs = false
	libraryd = false

	log('info', 'Updating Endpoint Data')

	updatePoolStats();

	updateMiningInfo();

	updateFloMarketData();

	updateBalance();

	getRigList();

	updateRentals();

	updateProfiles();
}

function updatePoolStats(){
	request('https://api.alexandria.io/pool/api/stats', function (error, response, body) {
		if (!error && response.statusCode === 200) {
			calculations['pool_hashrate'] = JSON.parse(body)['pools']['florincoin']['hashrate']
			alexandriaPool = true
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints()
		} else {
			logError('Error getting data from https://api.alexandria.io/pool/api/stats', error + '\n' + response + '\n' + body)
			updatePoolStats()
		}
	})
}

function updateMiningInfo(){
	request('https://api.alexandria.io/florincoin/getMiningInfo', function (error, response, body) {
		if (!error && response.statusCode === 200) {
			calculations['fbd_networkhashps'] = JSON.parse(body)['networkhashps']
			calculations['flo_difficulty'] = JSON.parse(body)['difficulty']
			florincoinInfo = true
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints()
		} else {
			logError('Error getting data from https://api.alexandria.io/florincoin/getMiningInfo', error + '\n' + response + '\n' + body)
			updateMiningInfo();
		}
	})
}

function updateFloMarketData(){
	request('https://api.alexandria.io/flo-market-data/v1/getAll', function (error, response, body) {
		if (!error && response.statusCode === 200) {
			calculations['fmd_weighted_btc'] = parseFloat(JSON.parse(body)['weighted'])
			calculations['fmd_weighted_usd'] = parseFloat(JSON.parse(body)['USD'])
			libraryd = true
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints()
		} else {
			logError('Error getting data from https://api.alexandria.io/flo-market-data/v1/getAll', error + '\n' + response + '\n' + body)
			updateFloMarketData()
		}
	})
}

function updateRentals(){
	// List the rentals and log that
	MRRAPI.listMyRentals(function (error, response) {
		if (error) {
			console.log(error)
			return
		}

		try {
			var body = JSON.parse(response)
		} catch (e) {
			throwError("Error parsing JSON on updateRentals");
		}

		if (body['success']){
			log('status', response, '', 'rentals')
		} else {
			updateRentals();
		}
		
	})
}

function updateProfiles(callback){
	if (!callback){
		callback = function(){}
	}
	MRRAPI.listProfiles(function (error, response) {
		if (error) {
			console.log(error)
			return
		}
		// Just write to the settings, don't log it anywhere.
		try {
			var body = JSON.parse(response)
		} catch (e) {
			throwError("Error parsing JSON on updateRentals");
		}

		if (body['success']){
			settings.profiles = body.data;
			callback(settings.profiles)
		} else {
			updateProfiles();
		}
	})
}

function updateBalance(callback) {
	if (!callback){
		callback = function(){};
	}

	MRRAPI.getBalance(function (error, response) {
		if (error) {
			throwError('Error getting balance from MiningRigRentals!', error)
			return
		}

		// If we fail, try again recursivly, otherwise, log this into the record.
		if (!JSON.parse(response).success) {
			//throwError('Error getting balance, ' + JSON.parse(response).message)
			// Recursivly try.
			return updateBalance();
		} else {
			var balance = JSON.parse(response)['data']['confirmed']
			log('info', 'Current balance is: ' + balance, response)
			log('curbal', balance, '', 'balance')
			callback(balance);
		}
		
	})
}

function getRigList (args, callback){
	if (!args){
		args = {type: 'scrypt'};
	}
	if (!callback){
		callback = function(){}
	}

	MRRAPI.listRigs(args, function (err, resp) {
		if (!!err){
			getRigList(args, callback);
			return;
		}
			

		try {
			var body = JSON.parse(resp)
		} catch (e) {
			throwError("Error parsing JSON on getRigList");
		}

		if (body['success']) {
			calculations['MiningRigRentals_last10'] = parseFloat(body['data']['info']['price']['last_10'])
			miningRigs = true
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd){
				doneUpdatingEndpoints()
			}

			callback(body);
		} else {
			getRigList(args, callback);
			return;
		}
	})
}

function doneUpdatingEndpoints () {
	log('info', 'Finished updating endpoint data, updating calculations!')

	updateCalculations()
}

function updateCalculations () {
	var FLO_reward = 12.5; // Next to change ~9/1/18

	calculations['mining_cost_per_sec'] = calculations['MiningRigRentals_last10'] / ( 1000000 * 86400);

	calculations['flo_spotcost_btc'] = (calculations['fbd_networkhashps'] * calculations['mining_cost_per_sec'] * 40) / FLO_reward;
	calculations['flo_spotcost_usd'] = calculations['flo_spotcost_btc'] * calculations['fmd_weighted_usd'] / calculations['fmd_weighted_btc']
	calculations['pool_influence'] = calculations['pool_hashrate'] / calculations['fbd_networkhashps'];

	if (calculations['pool_influence'] <= 1) {
		calculations['pool_influence_code'] = 0
		calculations['pool_influence_multiplier'] = 1
	}
	else {
		calculations['pool_influence_code'] = 1
		calculations['pool_influence_multiplier'] = 1 / (calculations['pool_influence'] * calculations['pool_influence'])
	}

	calculations['market_conditions'] = (((((calculations['pool_max_margin'] / 100) + 1) * calculations['flo_spotcost_btc']) - calculations['fmd_weighted_btc']) / calculations['fmd_weighted_btc'])

	if (calculations['market_conditions'] <= 0) {
		calculations['market_conditions_code'] = 0
		calculations['market_conditions_multiplier'] = 1
	} else if (calculations['market_conditions'] > 0 && calculations['market_conditions'] <= 1) {
		calculations['market_conditions_code'] = 1
		calculations['market_conditions_multiplier'] = 1 - (Math.pow(calculations['market_conditions'], 0.5))
	} else {
		calculations['market_conditions_code'] = 2
		calculations['market_conditions_multiplier'] = 0
	}

	calculations['offer_btc'] = calculations['flo_spotcost_btc'] * (1 + ((calculations['pool_max_margin'] / 100) * calculations['pool_influence_multiplier'] * calculations['market_conditions_multiplier'])) / calculations['fmd_weighted_btc'] * calculations['fmd_weighted_usd'];
}

function rentMiners () {
	if (parseFloat(calculations['pool_margin']) < parseFloat(settings['min_margin'])){
		calculations.status = "Not renting rigs, margin not met. (" + parseFloat(calculations['pool_margin']) + " vs " + parseFloat(settings['min_margin']) + ")";
		console.log("\x1b[35m" + calculations.status +  "\x1b[0m");
		log('status', calculations.status, '', 'rentals');
		return;
	}

	// First search for rentals that are below the average price.
	getRigList({type: 'scrypt'}, function (body) {
		log('info', 'Successfully got rig list')
		var rigs = body['data']['records']
		var goodRigs = []
		var rigsToRent = []
		// Add the rigs to the good rigs if they are available for at least a week and are below the average price.
		for (var i = 0; i < rigs.length; i++) {
			if (rigs[i]['minhrs'] <= settings.rental_length_hrs && rigs[i]['maxhrs'] >= settings.rental_length_hrs)
				goodRigs.push(rigs[i])
		}

		// Sort the rigs by RPI
		goodRigs.sort(function (a, b) {
			return parseFloat(a.price) - parseFloat(b.price)
		})
		// Check the RPI of each rig and add it to the rigsToRent as long as we are under the weekly budget.
		var totalCost = 0
		var totalNewHash = 0
		var amountToSpend = calculateSpendable(function (spendable) {
			var minMinerCost = 1;
			var minMultiplier = -1;
			var rentedOne = false;

			for (var i = 0; i < goodRigs.length; i++) {
				// Check to make sure the rpi threashold is ok, if not, get out of this loop and onto the next.
				if (parseFloat(goodRigs[i].rpi) <= parseFloat(settings['RPI_threshold'])){
					//console.log("\x1b[33m Rig " + i + ' has a bad RPI, not renting!' + '\x1b[0m');
					continue;
				}

				var mrr_times_multiplier = parseFloat(calculations['MiningRigRentals_last10']) * settings['mrr_last_10_max_multiplier'];
				if (parseFloat(goodRigs[i]['price']) > mrr_times_multiplier){
					var suggestedMultiplier = parseFloat(goodRigs[i]['price']) / calculations['MiningRigRentals_last10'];

					if (minMultiplier === -1 || minMultiplier > suggestedMultiplier)
						minMultiplier = suggestedMultiplier;
					//console.log("\x1b[33m Rig " + i + ' is higher than MRR last 10, not renting! (' + goodRigs[i]['price'] + ' vs ' + parseFloat(calculations['MiningRigRentals_last10']) + '/' + (parseFloat(calculations['MiningRigRentals_last10']) * settings['mrr_last_10_max_multiplier']) + ')' + '\x1b[0m');
					continue;
				}

				var minerCost = parseFloat(goodRigs[i].price_hr) * settings['rental_length_hrs'];

				if ((totalCost + minerCost) >= spendable){
					if (minerCost < minMinerCost)
						minMinerCost = minerCost;

					//console.log("\x1b[33m Rig " + i + ' would cost too much to rent, not renting! (' + parseFloat(goodRigs[i].price_hr) + ' * ' + settings['rental_length_hrs'] + ' = ' + minerCost + ')\x1b[0m');
					continue;
				}

				// Hard minimum of 0.00000100 on MRR
				if (parseFloat(goodRigs[i].price_hr) * settings['rental_length_hrs'] < 0.00000100){
					continue;
				}
				
				rigsToRent.push(goodRigs[i])
				totalNewHash += parseFloat(goodRigs[i].hashrate)
				totalCost += parseFloat(goodRigs[i].price_hr) * settings['rental_length_hrs']
				calculations['pool_hashrate'] = parseInt(calculations['pool_hashrate']) + parseInt(goodRigs.hashrate)
				goodRigs.splice(i, 1)
				updateCalculations()

				rentedOne = true;
			}
			// for (var i = 0; i < goodRigs.length; i++) {
			// 	if (parseFloat(goodRigs[i].rpi) > parseFloat(settings['RPI_threshold']) && (totalCost + (parseFloat(goodRigs[i].price_hr) * settings['rental_length_hrs'])) <= spendable && calculations['pool_margin'] >= settings['min_margin']) {
			// 		console.log("Here2");
			// 		rigsToRent.push(goodRigs[i])
			// 		totalNewHash += parseFloat(goodRigs[i].hashrate)
			// 		totalCost += parseFloat(goodRigs[i].price_hr) * settings['rental_length_hrs']
			// 		calculations['pool_hashrate'] = parseInt(calculations['pool_hashrate']) + parseInt(goodRigs.hashrate)
			// 		updateCalculations()
			// 	}
			// }

			if (!rentedOne && minMinerCost != 1){
				var suggestedNewWeeklyMin = (minMinerCost/settings['rental_length_hrs']) * 168;
				calculations.status = "Unable to rent any rigs, cheapest rental cost is " + minMinerCost.toFixed(8) + " but max budget is " + spendable.toFixed(8) + ". Please raise your weekly minimum to at least: " + suggestedNewWeeklyMin.toFixed(8) + ".";
				console.log("\x1b[31m" + calculations.status + "\x1b[0m");
				log('status', calculations.status, '', 'rentals');
				return;
			}

			if (!rentedOne && minMultiplier != -1){
				calculations.status = "Your MRR last 10 multiplier might be too low, please check it or update it to at least " + minMultiplier.toFixed(2) + " to continue renting rigs immediately, or wait for prices to lower.";
				console.log("\x1b[31m" + calculations.status + "\x1b[0m");
				log('status', calculations.status, '', 'rentals');
				return;
			}

			if (rigsToRent.length !== 0) {
				updateBalance(function (balance) {
					if (parseFloat(balance) > totalCost) {
						for (var i = 0; i < rigsToRent.length; i++) {
							// MRR does not allow rentals that cost less than 0.00000100 BTC
							if (rigsToRent[i].price_hr * settings.rental_length_hrs < 0.00000100){
								continue;
							}

							var args = {
								'id': parseInt(rigsToRent[i].id),
								'length': settings.rental_length_hrs,
								'profileid': settings.profileid
							}
							//console.log(args)
							MRRAPI.rentRig(args, function (error, response) {
								if (error) {
									throwError('Error renting rig!', error + '\n' + response)
								}
								response = JSON.parse(response);
								if (response.success){
									calculations.status = 'Successfully rented rig: "' + response.data.rigid + '" for ' + response.data.price + ' BTC';
									console.log("\x1b[36m" + calculations.status + "\x1b[0m");
									log('rental', calculations.status, JSON.stringify(response))
									log('spend', response.data.price, JSON.stringify(response), 'balance')
								} else {
									calculations.status = 'Error renting rig: ' + response.message;
									console.log("\x1b[36m" + 'Error renting rig: ' + response.message + "\x1b[0m");
								}
							})
						}
					} else {
						calculations.status = "Not enough balance in wallet to rent miners!";
						throwError(calculations.status)
					}
				})
			}
		})
	})
}

var emitter = new EventEmitter();

function log (type, message, extrainfo, table, callback) {
	if (!extrainfo)
		extrainfo = ''

	if (!table)
		table = 'log'

	if (!callback)
		callback = function (data) {}

	if (table === 'log')
		var cols = '(timestamp, type, message, extrainfo)'
	else if (table === 'balance')
		var cols = '(timestamp, type, amount, extrainfo)'
	else if (table === 'rentals')
		var cols = '(timestamp, type, response, extrainfo)'

	// Store log in database
	db.serialize(function () {
		db.run('INSERT INTO ' + table + ' ' + cols + ' VALUES (' + parseInt(Date.now() / 1000) + ',\'' + type + '\', \'' + message + '\', \'' + extrainfo + '\');', function () {
			callback()
		})
	})

	emitter.emit("log", "Type: " + type + " | Message: " + message + " | Extra Info: " + extrainfo);
}

function logError (message, extraInfo){
	if (!extraInfo)
		extraInfo = ''

	log('error', message, extraInfo, 'log')
	emitter.emit("error", message + " | " + extraInfo);
}

function throwError (message, extraInfo) {
	if (!extraInfo)
		extraInfo = ''

	logError(message, extraInfo);

	console.log(message)
	console.log(extraInfo)
}

function loadConfig (callback) {
	if (!fs.existsSync(__dirname + '/settings.cfg')){
		//copyFile(__dirname + '/settings.example.cfg', __dirname + '/settings.cfg')
		installed = false;
	} else {
		installed = true;
	}

	var data = '';

	if (fs.existsSync(__dirname + '/settings.cfg')){
		data = fs.readFileSync(__dirname + '/settings.cfg')
	}

	try {
		if (data === '') {
			copyFile(__dirname + '/settings.example.cfg', __dirname + '/settings.cfg')
			var data = fs.readFileSync(__dirname + '/settings.cfg')
		}
		settings = JSON.parse(data)

		if (settings.profileid === -1) {
			installStepTwo = true;
		} 

		if (settings.MRR_API_key === 'sample-api-key' || settings.MRR_API_secret === 'sample-api-secret' || settings.profileid === -1) {
			console.log('Welcome to the OIP Autominer!\n')
			console.log('It looks like you have not yet setup the Autominer yet, please follow the directions found here: bit.ly/2rAVVVi\n\n')

			if (settings.MRR_API_key === 'sample-api-key') {
				var api_key = readlineSync.question('Please enter your MiningRigRentals API Key: ')
				settings.MRR_API_key = api_key

				saveConfig()
			}

			if (settings.MRR_API_secret === 'sample-api-secret') {
				var api_secret = readlineSync.question('Please enter your MiningRigRentals API Secret: ')
				settings.MRR_API_secret = api_secret

				saveConfig()
			}

			var weekly_budget = readlineSync.question('How much BTC would you like to spend each week?: ')
			if (weekly_budget) {
				settings.weekly_budget_btc = weekly_budget
				saveConfig()
			}

			console.log('The "minimum margin" is the threashold at which it will begin mining. If this is set to 0, then it will always rent, however if you set it to anything higher, it will wait until the margin is met to begin mining.')
			var minmargin = readlineSync.question('Please enter your "minimum margin": ')
			if (minmargin) {
				settings.min_margin = minmargin
				saveConfig()
			}

			console.log('The RPI threashold is the minimum machine avaialbilty that will be accepted. An RPI threashold of 80 is standard.')
			var minrpi = readlineSync.question('Please enter your RPI threashold: ')
			if (minrpi) {
				settings.RPI_threshold = minrpi
				saveConfig()
			}

			console.log('Please enter the maximum difficulty at which you want to mine (Optional)')
			var maxdiff = readlineSync.question('Please enter your Max Mining Difficulty (Optional, default is 3500): ')
			if (maxdiff) {
				if (isNaN(maxdiff)){
					maxdiff = 3500;
				} else {
					maxdiff = parseFloat(maxdiff);
				}
				settings.max_difficulty = maxdiff
				saveConfig()
			}

			var apikey = readlineSync.question('Please enter a password for this API: ')
			if (apikey) {
				settings.api_key = apikey
				saveConfig()
			}

			if (MRRAPI === null) {
				MRRAPI = new MiningRigRentalsAPI(settings.MRR_API_key, settings.MRR_API_secret)
			}

			if (settings.profileid === -1) {
				updateProfiles(function (profiles) {
					console.log(' ======== PROFILES ======== ')
					for (var i = profiles.length - 1; i >= 0; i--) {
						console.log('ID: ' + profiles[i].id + ' | ' + 'Name: ' + profiles[i].name)
					}
					console.log(' ========================== ')

					var profileid = readlineSync.question('Please enter a PROFILE ID from the list above: ')
					settings.profileid = profileid

					saveConfig()

					callback(settings)
				})
			} else {
				callback(settings)
			}
		} else {
			if (MRRAPI === null) {
				MRRAPI = new MiningRigRentalsAPI(settings.MRR_API_key, settings.MRR_API_secret)
			}
			callback(settings)
		}
	} catch (e) {
		throwError('Error loading Config', 'There was an error loading the config, please double check that it is correctly written and valid JSON!\n' + e)
	}
}

function saveConfig () {
	try {
		fs.writeFileSync(__dirname + '/settings.cfg', JSON.stringify(settings, null, 4))
	} catch (e) {
		throwError('Error writing config', e)
	}

}

function copyFile (source, target) {
	try {
		var data = fs.readFileSync(source)
		fs.writeFileSync(target, data)
	} catch (e) {
		throwError('Error creating default settings file from settings.example.cfg', e)
	}
}

function getLogs (amount, callback) {
	var logs = {'amount': amount, 'logs': []}
	if (amount === -1)
		amount = ';'
	else
		amount = ' LIMIT ' + amount + ';'

	var amntTmp = 0
	db.parallelize(function () {
		db.all('SELECT id, timestamp, type, message, extrainfo FROM log ORDER BY timestamp DESC, type DESC' + amount, function (err, rows) {
			if (err) {
				console.log(err)
			}
			logs.logs = rows
			logs.amount = rows.length
			callback(err, logs)
		})
	})
}

function getRentals (amount, callback) {
	var logs = {'amount': amount, 'logs': []}
	if (amount === -1)
		amount = ';'
	else
		amount = ' LIMIT ' + amount + ';'

	var amntTmp = 0
	db.parallelize(function () {
		db.all('SELECT id, timestamp, type, response, extrainfo FROM rentals ORDER BY timestamp DESC, type DESC' + amount, function (err, rows) {
			if (err) {
				console.log(err)
			}
			logs.logs = rows
			logs.amount = rows.length
			callback(err, logs)
		})
	})
}

function calculateSpendable (callback) {
	db.parallelize(function () {
		db.all('SELECT * FROM balance ORDER BY id DESC, type DESC;', function (err, rows) {
			if (err) {
				console.log(err)
			}
			if (settings.spend_entire_weekly_at_once) {
				// Calculate since last calender week
				var currentDate = new Date
				var sun = currentDate.getDate() - currentDate.getDay()
				var sunday = new Date(currentDate.setDate(sun))
				sunday.setHours(0)
				sunday.setMinutes(0)
				sunday.setSeconds(0)

				// This is the timestamp since the start of the last calender week. We need to get the amount of money that we can spend.
				var unixSunday = sunday.getTime() / 1000

				// Calculate how much we have spent since that last unix time.
				var spentSoFar = 0
				for (var row in rows) {
					if (rows.hasOwnProperty(row))
						if (row.timestamp >= unixSunday && row.type === 'spend') {
							spentSoFar += row.amount
						}
				}

				// Subtract how much we have spent so far this week and return how much we have left to spend
				var leftToSpend = settings.weekly_budget_btc - spentSoFar

				callback(leftToSpend)
			} else {
				// Budget for rental length peroid.
				var budget = (settings['weekly_budget_btc'] / 168) * settings['rental_length_hrs']
				//console.log('Calculated budget is: ' + budget)
				callback(budget)
			}
		})
	})
}

function getLastRentalTimestamp (callback) {
	try {
		db.parallelize(function () {
			db.all("SELECT * FROM balance ORDER BY id DESC;", function (err, rows) {
				if (err) {
					console.log(err)
				}

				var returned = false;

				for (var i = 0; i < rows.length; i++) {
					if (rows[i].type && rows[i].type == 'spend' && rows[i].extrainfo){
						var res = JSON.parse(rows[i].extrainfo);
						if (res.success){
							returned = true;
							callback(rows[i].timestamp);
							break;
						}
					}
				}

				if (!returned){
					callback(-1);
				}
			})
		})
	} catch (e) {
		console.log(e);
	}
}

var logHighDiff = false;
var logWaiting = false;

function rentIfYouCan() {
	getLastRentalTimestamp(function(timestamp){
		var nowTime = parseInt((new Date).getTime()/1000);
		var rentalPeriodSeconds = settings.rental_length_hrs * 60 * 60;

		// This is the time stamp -x hours ago from now
		var lastRentalLatestPossible = nowTime - rentalPeriodSeconds;
		// If we have not rented in more than our rental period (i.e. our last machine should now be expiring)
		if (timestamp <= lastRentalLatestPossible){
			logWaiting = false;

			// Check to make sure that we are under the maximum difficulty right now
			if (calculations['flo_difficulty'] > settings.max_difficulty){
				if (!logHighDiff){
					calculations.status = "Difficulty too high... Waiting to rent rigs...";
					console.log(calculations.status);
					log('status', calculations.status, '', 'rentals');
					logHighDiff = true;
				}
			} else {
				logHighDiff = false;
				rentMiners();
			}
		} else {
			if (!logWaiting){
				calculations.status = "Just rented a rig... Waiting for rental period to end..."; 
				console.log("\x1b[33m" + calculations.status + "\x1b[0m");
				log('status', calculations.status, '', 'rentals');
				logWaiting = true;
			}
		}
	});
}

function startup (){
	loadConfig(function () {
		// clearTimeout(startupTimeout);
		// Initially update endpoint data on startup
		updateEnpointData();
		// 								 minutes * seconds * ms
		var endpoint = setInterval(updateEnpointData, 15 * 60 * 1000);

		// After 10 seconds, rent the first batch of rigs, then every x amount of hours after that attempt to rent again.
		setTimeout(rentIfYouCan, 10 * 1000);
		// Run the rental checker every 5 minutes to make sure that we always rent if we can.
		var rentals = setInterval(rentIfYouCan, 5 * 60 * 1000);
		// settings.rental_length_hrs * 60 * 60 * 1000
	})
}

var port = 8123 + parseInt(Math.random() * 100);
app.listen(port, function () {
	calculations.status = 'autominer-api listening on port ' + port + ' using http!';
	console.log(calculations.status);
	log('status', calculations.status, '', 'rentals');
});

// If the app was started from the terminal, go through the regular startup :)
if (require.main === module) {
	// If started from terminal, enable API...
	enable_API = true;
    startup();
}

// var startupTimeout = setTimeout(startup, 5 * 1000);

process.stdin.resume()//so the program will not close instantly

function exitHandler (options, err) {
	log('error', 'autominer-api Shut Down', '', 'log', function () {
		if (err) console.log(err.stack)
		if (options.exit) process.exit()
	})
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, {cleanup: true}))

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit: true}))

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit: true}))

module.exports = {
	setupInstall: function(api_key, api_secret, weekly_spend, min_margin, min_rpi, max_difficulty, api_password, profileCallback, error){
		var data = '';

		if (fs.existsSync(__dirname + '/settings.cfg')){
			data = fs.readFileSync(__dirname + '/settings.cfg')
		}

		if (data === '') {
			copyFile(__dirname + '/settings.example.cfg', __dirname + '/settings.cfg')
			var data = fs.readFileSync(__dirname + '/settings.cfg')
		}

		settings = JSON.parse(data);

		settings.MRR_API_key = api_key;
		settings.MRR_API_secret = api_secret;
		settings.weekly_budget_btc = weekly_spend;
		settings.min_margin = min_margin;
		settings.RPI_threshold = min_rpi;
		settings.max_difficulty = max_difficulty;
		settings.api_key = api_password;

		saveConfig()

		MRRAPI = new MiningRigRentalsAPI(settings.MRR_API_key, settings.MRR_API_secret)

		if (settings.profileid === -1) {
			updateProfiles(function (profiles) {
				profileCallback(profiles, function(profileid){
					settings.profileid = profileid

					saveConfig()

					startup()
				});
			})
		} else {
			profileCallback(undefined, function(){
				saveConfig()

				startup()
			})
		}
	},
	selectProfile: function(profile_num, success, error){

	},
	onEvent: function(eventType, runMe){
		emitter.on(eventType, runMe);
	},
	doesConfigExist: function(){
		return fs.existsSync(__dirname + '/settings.cfg')
	},
	startup: startup
}