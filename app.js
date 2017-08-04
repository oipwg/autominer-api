var express = require('express')
var request = require('request')
var MiningRigRentalsAPI = require('miningrigrentals-api')
var sqlite3 = require('sqlite3').verbose()
var fs = require('fs')
var readlineSync = require('readline-sync')
var app = express()
var bodyParser = require('body-parser')
app.use(bodyParser.json()) // support json encoded bodies
app.use(bodyParser.urlencoded({extended: true})) // support encoded bodies

var dbfile = __dirname + '/autominer.db'
var exists = fs.existsSync(dbfile)
var db = new sqlite3.Database(dbfile)

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
	'pool_max_margin': 20,
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

var settings
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

app.get('/', function (req, res) {
	res.send('')
})

app.get('/info', function (req, res) {
	var pretty = calculations
	pretty['pool_hashrate'] = parseFloat(pretty['pool_hashrate'].toFixed(0))
	pretty['flo_spotcost_btc'] = parseFloat(pretty['flo_spotcost_btc'].toFixed(8))
	pretty['flo_spotcost_usd'] = parseFloat(pretty['flo_spotcost_usd'].toFixed(8))
	pretty['market_conditions'] = parseFloat(pretty['market_conditions'].toFixed(8))
	pretty['offer_btc'] = parseFloat(pretty['offer_btc'].toFixed(8))

	res.send(pretty)
})

app.post('/config', function (req, res) {
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

function updateEnpointData () {
	// Request data async from each endpoint. When all four have been queried then update the calculations.
	var alexandriaPool = false
	var florincoinInfo = false
	var miningRigs = false
	var libraryd = false

	log('info', 'Updating Endpoint Data')

	request('https://api.alexandria.io/pool/api/stats', function (error, response, body) {
		if (!error && response.statusCode === 200) {
			calculations['pool_hashrate'] = JSON.parse(body)['pools']['florincoin']['hashrate']
			alexandriaPool = true
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints()
		} else {
			throwError('Error getting data from https://api.alexandria.io/pool/api/stats', error + '\n' + response + '\n' + body)
		}
	})

	request('https://api.alexandria.io/florincoin/getMiningInfo', function (error, response, body) {
		if (!error && response.statusCode === 200) {
			calculations['fbd_networkhashps'] = JSON.parse(body)['networkhashps']
			florincoinInfo = true
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints()
		} else {
			throwError('Error getting data from https://api.alexandria.io/florincoin/getMiningInfo', error + '\n' + response + '\n' + body)
		}
	})

	request('https://api.alexandria.io/flo-market-data/v1/getAll', function (error, response, body) {
		if (!error && response.statusCode === 200) {
			calculations['fmd_weighted_btc'] = parseFloat(JSON.parse(body)['weighted'])
			calculations['fmd_weighted_usd'] = parseFloat(JSON.parse(body)['USD'])
			libraryd = true
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints()
		} else {
			throwError('Error getting data from https://api.alexandria.io/flo-market-data/v1/getAll', error + '\n' + response + '\n' + body)
		}
	})

	MRRAPI.getBalance(function (error, response) {
		if (error) {
			throwError('Error getting balance from MiningRigRentals!', error)
			return
		}

		console.log(response)
		if (!JSON.parse(response).success) {
			throwError('Error getting balance, ' + JSON.parse(response).message)
			return
		}
		var balance = JSON.parse(response)['data']['confirmed']
		log('info', 'Current balance is: ' + balance, response)
		log('curbal', balance, '', 'balance')
	})

	MRRAPI.listRigs({type: 'scrypt'}, function (err, resp) {
		if (!!err)
			return throwError('Error getting data from MRR.listRigs', err + '\n' + resp)

		var body = JSON.parse(resp)
		if (body['success']) {
			calculations['MiningRigRentals_last10'] = parseFloat(body['data']['info']['price']['last_10'])
			miningRigs = true
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints()
		} else {
			throwError('Error getting data from MRR.listRigs', err + '\n' + resp)
		}
	})

	// List the rentals and log that
	MRRAPI.listMyRentals(function (error, response) {
		if (error) {
			console.log(error)
			return
		}
		log('status', response, '', 'rentals')
	})

	MRRAPI.listProfiles(function (error, response) {
		if (error) {
			console.log(error)
			return
		}
		// Just write to the settings, don't log it anywhere.
		settings.profiles = JSON.parse(response).data
	})
}

function doneUpdatingEndpoints () {
	log('info', 'Finished updating endpoint data, updating calculations!')

	updateCalculations()
}

function updateCalculations () {
	var FLO_reward = 25
	calculations['flo_spotcost_btc'] = calculations['fbd_networkhashps'] * calculations['MiningRigRentals_last10'] / 1000000 / (2160 * FLO_reward)
	calculations['flo_spotcost_usd'] = calculations['flo_spotcost_btc'] * calculations['fmd_weighted_usd'] / calculations['fmd_weighted_btc']
	calculations['pool_influence'] = calculations['pool_hashrate'] / (calculations['fbd_networkhashps'] - calculations['pool_hashrate'])

	if (calculations['pool_influence'] <= 1) {
		calculations['pool_influence_code'] = 0
		calculations['pool_influence_multiplier'] = 1
	}
	else {
		calculations['pool_influence_code'] = 1
		calculations['pool_influence_multiplier'] = 1 / (calculations['pool_influence'] * calculations['pool_influence'])
	}

	calculations['market_conditions'] = ((((calculations['pool_max_margin'] / 100) + 1) * calculations['flo_spotcost_btc']) / calculations['fmd_weighted_btc'])

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

	calculations['pool_margin'] = calculations['pool_max_margin'] * calculations['pool_influence_multiplier'] * calculations['market_conditions_multiplier']

	calculations['offer_btc'] = calculations['flo_spotcost_btc'] * (1 + calculations['pool_margin'])
}

function rentMiners () {
	// First search for rentals that are below the average price.
	MRRAPI.listRigs({type: 'scrypt'}, function (err, resp) {
		if (!!err)
			return throwError('Error getting data from MRR.listRigs', err + '\n' + resp)

		var body = JSON.parse(resp)
		if (body['success']) {
			log('info', 'Successfully got rig list')
			var rigs = body['data']['records']
			var goodRigs = []
			var rigsToRent = []
			// Add the rigs to the good rigs if they are available for at least a week and are below the average price.
			for (var i = 0; i < rigs.length; i++) {
				if (rigs[i]['minhrs'] <= settings.rental_length_hrs && rigs[i]['maxhrs'] >= settings.rental_length_hrs)
					goodRigs.push(rigs[i])
			}

			console.log(goodRigs.length)
			// Sort the rigs by RPI
			goodRigs.sort(function (a, b) {
				return parseFloat(a.price) - parseFloat(b.price)
			})
			// Check the RPI of each rig and add it to the rigsToRent as long as we are under the weekly budget.
			var totalCost = 0
			var totalNewHash = 0
			var amountToSpend = calculateSpendable(function (spendable) {
				for (var i = 0; i < goodRigs.length; i++) {
					if (goodRigs[i].rpi >= settings['RPI_threshold'] && goodRigs[i]['price'] < calculations['MiningRigRentals_last10'] && (totalCost + (parseFloat(goodRigs[i].price_hr) * settings['rental_length_hrs'])) <= spendable && calculations['pool_margin'] >= settings['min_margin']) {
						rigsToRent.push(goodRigs[i])
						totalNewHash += parseFloat(goodRigs[i].hashrate)
						totalCost += parseFloat(goodRigs[i].price_hr) * settings['rental_length_hrs']
						calculations['pool_hashrate'] = parseInt(calculations['pool_hashrate']) + parseInt(goodRigs.hashrate)
						goodRigs.splice(i, 1)
						updateCalculations()
					}
				}
				for (var i = 0; i < goodRigs.length; i++) {
					if (goodRigs[i].rpi > settings['RPI_threshold'] && (totalCost + (parseFloat(goodRigs[i].price_hr) * settings['rental_length_hrs'])) <= spendable && calculations['pool_margin'] >= settings['min_margin']) {
						rigsToRent.push(goodRigs[i])
						totalNewHash += parseFloat(goodRigs[i].hashrate)
						totalCost += parseFloat(goodRigs[i].price_hr) * settings['rental_length_hrs']
						calculations['pool_hashrate'] = parseInt(calculations['pool_hashrate']) + parseInt(goodRigs.hashrate)
						updateCalculations()
					}
				}

				console.log(rigsToRent)
				console.log('Hashrate to Rent: ' + (totalNewHash / 1000000000))
				console.log('Cost to Rent: ' + totalCost)

				if (rigsToRent.length !== 0) {
					MRRAPI.getBalance(function (error, response) {
						if (error) {
							throwError('Error getting balance from MiningRigRentals!', error)
							return
						}

						console.log(response)
						if (!JSON.parse(response).success) {
							throwError('Error getting balance, ' + JSON.parse(response).message)
							return
						}
						var balance = JSON.parse(response)['data']['confirmed']
						log('info', 'Current balance is: ' + balance, response)
						log('curbal', balance, '', 'balance')
						if (parseFloat(balance) > totalCost) {
							for (var i = 0; i < rigsToRent.length; i++) {
								console.log(rigsToRent[i])
								var args = {
									'id': parseInt(rigsToRent[i].id),
									'length': settings.rental_length_hrs,
									'profileid': settings.profileid
								}
								console.log(args)
								MRRAPI.rentRig(args, function (error, response) {
									if (error) {
										throwError('Error renting rig!', error + '\n' + response)
									}
									response = JSON.parse(response)
									log('rental', 'Successfully rented rig: "' + response.data.rigid + '" for ' + response.data.price + ' BTC', JSON.stringify(response))
									log('spend', response.data.price, JSON.stringify(response), 'balance')
								})
							}
						} else {
							throwError('Not enough balance in wallet to rent miners!')
						}
					})
				}
			})
		} else {
			throwError('Error getting rig list from MiningRigRentals!', err + '\n' + resp + '\n' + body)
		}
	})
}

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
}

function throwError (message, extraInfo) {
	if (!extraInfo)
		extraInfo = ''

	log('error', message, extraInfo, 'log')

	console.log(message)
	console.log(extraInfo)
}

function loadConfig (callback) {
	if (!fs.existsSync(__dirname + '/settings.cfg'))
		copyFile(__dirname + '/settings.example.cfg', __dirname + '/settings.cfg')

	var data = fs.readFileSync(__dirname + '/settings.cfg')
	try {
		if (data === '') {
			copyFile(__dirname + '/settings.example.cfg', __dirname + '/settings.cfg')
			var data = fs.readFileSync(__dirname + '/settings.cfg')
		}
		settings = JSON.parse(data)

		if (settings.MRR_API_key === 'sample-api-key' || settings.MRR_API_secret === 'sample-api-secret' || settings.profileid === -1) {
			console.log('Welcome to the Alexandria Autominer!\n')
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
			}

			console.log('The "minimum margin" is the threashold at which it will begin mining. If this is set to 0, then it will always rent, however if you set it to anything higher, it will wait until the margin is met to begin mining.')
			var minmargin = readlineSync.question('Please enter your "minimum margin": ')
			if (weekly_budget) {
				settings.min_margin = minmargin
			}

			console.log('The RPI threashold is the minimum machine avaialbilty that will be accepted. An RPI threashold of 80 is standard.')
			var minrpi = readlineSync.question('Please enter your RPI threashold: ')
			if (weekly_budget) {
				settings.RPI_threshold = minrpi
			}

			var apikey = readlineSync.question('Please enter a password for this API: ')
			if (weekly_budget) {
				settings.api_key = apikey
			}

			if (MRRAPI === null) {
				MRRAPI = new MiningRigRentalsAPI(settings.MRR_API_key, settings.MRR_API_secret)
			}

			if (settings.profileid === -1) {
				MRRAPI.listProfiles(function (error, response) {
					if (error) {
						console.log(error)
						return
					}
					// Just write to the settings, don't log it anywhere.
					settings.profiles = JSON.parse(response).data

					console.log(' ======== PROFILES ======== ')
					for (var i = settings.profiles.length - 1; i >= 0; i--) {
						console.log('ID: ' + settings.profiles[i].id + ' | ' + 'Name: ' + settings.profiles[i].name)
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
				console.log('Calculated budget is: ' + budget)
				callback(budget)
			}
		})
	})
}

function getLastRentalTimestamp (callback) {
	db.parallelize(function () {
		db.all("SELECT * FROM balance ORDER BY id DESC;", function (err, rows) {
			if (err) {
				console.log(err)
			}

			for (var i = 0; i < rows.length; i++) {
				if (rows[i].type && rows[i].type == 'spend' && rows[i].extrainfo){
					var res = JSON.parse(rows[i].extrainfo);
					if (res.success){
						callback(rows[i].timestamp);
						break;
					}
				}
			}
		})
	})
}

function rentIfYouCan() {
	getLastRentalTimestamp(function(timestamp){
		var nowTime = (new Date).getTime();
		var rentalPeriodSeconds = settings.rental_length_hrs * 60 * 60 * 1000;

		// This is the time stamp -x hours ago from now
		var lastRentalLatestPossible = nowTime - rentalPeriodSeconds;
		// If we have not rented in more than our rental period (i.e. our last machine should now be expiring)
		if (timestamp <= lastRentalLatestPossible){
			// Now that we know we can rent, send it off to the renter!
			rentMiners();
		}
	});
}

loadConfig(function () {
	var port = 3123
	app.listen(port, function () {
		console.log('autominer-api listening on port ' + port + '!')
		log('info', 'Started up autominer-api on port ' + port)
	});

	getLastRentalTimestamp(function(time){ console.log("Last: " + time + "\nNow: " + parseInt(Date.now()/1000)); });

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