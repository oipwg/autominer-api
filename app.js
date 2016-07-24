var express = require('express');
var request = require('request');
var MiningRigRentalsAPI = require('miningrigrentals-api');
var sqlite3 = require('sqlite3').verbose();
var fs = require('fs');
var app = express();
var bodyParser = require('body-parser');
app.use(bodyParser.json()); // support json encoded bodies
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies

var fs = require("fs");
var dbfile = __dirname + '/autominer.db';
var exists = fs.existsSync(dbfile);
var db = new sqlite3.Database(dbfile);

db.serialize(function() {
	if(!exists) {
		// Create the logs table
		db.run("CREATE TABLE log (id INTEGER PRIMARY KEY NOT NULL, timestamp INTEGER NOT NULL, type VARCHAR NOT NULL, message VARCHAR NOT NULL, extrainfo VARCHAR);");
		db.run("CREATE TABLE balance (id INTEGER PRIMARY KEY NOT NULL, timestamp INTEGER NOT NULL, type VARCHAR NOT NULL, amount INTEGER NOT NULL, extrainfo VARCHAR);");
	}
});

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

var settings;

app.get('/', function (req, res) {
		res.send('');
});

app.get('/info', function (req, res) {
	var pretty = calculations;
	pretty['pool_hashrate'] = parseFloat(pretty['pool_hashrate'].toFixed(0));
	pretty['flo_spotcost_btc'] = parseFloat(pretty['flo_spotcost_btc'].toFixed(8));
	pretty['flo_spotcost_usd'] = parseFloat(pretty['flo_spotcost_usd'].toFixed(8));
	pretty['market_conditions'] = parseFloat(pretty['market_conditions'].toFixed(8));
	pretty['offer_btc'] = parseFloat(pretty['offer_btc'].toFixed(8));
		res.send(pretty);
		rentMiners();
});

app.post('/config', function (req, res) {
	if (req.body.api_key && req.body['api_key'] == settings['api_key'])
		res.send(settings);
	else
		res.send('{"success":false,"message":"Incorrect API Key"}');
});

function updateEnpointData(){
	// Request data async from each endpoint. When all four have been queried then update the calculations.
	var alexandriaPool = false;
	var florincoinInfo = false;
	var miningRigs = false;
	var libraryd = false;

	log('info', 'Updating Endpoint Data');

	request('http://pool.alexandria.media/api/stats', function (error, response, body) {
			if (!error && response.statusCode == 200) {
			calculations['pool_hashrate'] = JSON.parse(body)['pools']['florincoin']['hashrate'];
			alexandriaPool = true;
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints();
			} else {
				throwError('Error getting data from http://pool.alexandria.media/api/stats', error + '\n' + response + '\n' + body);
			}
	})

	request('http://florincoin.alexandria.io/getMiningInfo', function (error, response, body) {
			if (!error && response.statusCode == 200) {
			calculations['fbd_networkhashps'] = JSON.parse(body)['networkhashps'];
			florincoinInfo = true;
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints();
			} else {
				throwError('Error getting data from http://florincoin.alexandria.io/getMiningInfo', error + '\n' + response + '\n' + body);
			}
	})

	request('https://www.miningrigrentals.com/api/v1/rigs?method=list&type=scrypt', function (error, response, body) {
			if (!error && response.statusCode == 200) {
			calculations['MiningRigRentals_last10'] = parseFloat(JSON.parse(body)['data']['info']['price']['last_10']);
			miningRigs = true;
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints();
			} else {
				throwError('Error getting data from https://www.miningrigrentals.com/api/v1/rigs?method=list&type=scrypt', error + '\n' + response + '\n' + body);
			}
	})

	request('https://api.alexandria.io/flo-market-data/v1/getAll', function (error, response, body) {
			if (!error && response.statusCode == 200) {
			calculations['fmd_weighted_btc'] = parseFloat(JSON.parse(body)['weighted']);
			calculations['fmd_weighted_usd'] = parseFloat(JSON.parse(body)['USD']);
			libraryd = true;
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				doneUpdatingEndpoints();
			} else {
				throwError('Error getting data from https://api.alexandria.io/flo-market-data/v1/getAll', error + '\n' + response + '\n' + body);
			}
	})
}

function doneUpdatingEndpoints(){
	log('info', 'Finished updating endpoint data, updating calculations!');

	updateCalculations();
}

function updateCalculations(){
	var FLO_reward = 25;
	calculations['flo_spotcost_btc'] = calculations['fbd_networkhashps'] * calculations['MiningRigRentals_last10'] / 1000000 / (2160 * FLO_reward);
	calculations['flo_spotcost_usd'] = calculations['flo_spotcost_btc'] * calculations['fmd_weighted_usd'] / calculations['fmd_weighted_btc'];
	calculations['pool_influence'] = calculations['pool_hashrate'] / (calculations['fbd_networkhashps'] - calculations['pool_hashrate']);

	if (calculations['pool_influence'] <= 1){
		calculations['pool_influence_code'] = 0;
		calculations['pool_influence_multiplier'] = 1;
	}
	else{
		calculations['pool_influence_code'] = 1;
		calculations['pool_influence_multiplier'] = 1 / (calculations['pool_influence'] * calculations['pool_influence']);
	}

	calculations['market_conditions'] = ((((calculations['pool_max_margin'] / 100) + 1) * calculations['flo_spotcost_btc']) / calculations['fmd_weighted_btc']);

	if (calculations['market_conditions'] <= 0){
		calculations['market_conditions_code'] = 0;
		calculations['market_conditions_multiplier'] = 1;
	} else if (calculations['market_conditions'] > 0 && calculations['market_conditions'] <= 1){
		calculations['market_conditions_code'] = 1;
		calculations['market_conditions_multiplier'] = 1 - (Math.pow(calculations['market_conditions'], 0.5));
	} else {
		calculations['market_conditions_code'] = 2;
		calculations['market_conditions_multiplier'] = 0;
	}

	calculations['pool_margin'] = calculations['pool_max_margin'] * calculations['pool_influence_multiplier'] * calculations['market_conditions_multiplier'];

	calculations['offer_btc'] = calculations['flo_spotcost_btc'] * (1 + calculations['pool_margin']);
}

function rentMiners(){
	// First search for rentals that are below the average price.
	request('https://www.miningrigrentals.com/api/v1/rigs?method=list&type=scrypt', function (error, response, body) {
			if (!error && response.statusCode == 200) {
				log('info', 'Successfully got rig list');
				var rigs = JSON.parse(body)['data']['records'];
				var goodRigs = [];
				var rigsToRent = [];
				// Add the rigs to the good rigs if they are available for at least a week and are below the average price.
				for (var i = 0; i < rigs.length; i++) {
					if (rigs[i]['minhrs'] <= settings.rental_length_hrs && rigs[i]['maxhrs'] >= settings.rental_length_hrs)
						goodRigs.push(rigs[i]);
				}
			
			console.log(goodRigs.length);
			// Sort the rigs by RPI
			goodRigs.sort(function(a, b) {
				return parseFloat(a.price) - parseFloat(b.price);
			});
			// Check the RPI of each rig and add it to the rigsToRent as long as we are under the weekly budget.
			var totalCost = 0;
			var totalNewHash = 0;
			for (var i = 0; i < goodRigs.length; i++) {
				if (goodRigs[i].rpi >= settings['RPI_threshold'] && goodRigs[i]['price'] < calculations['MiningRigRentals_last10'] && (totalCost + parseFloat(goodRigs[i].price_hr)) <= ((settings['weekly_budget_btc']/168)*settings['rental_length_hrs']) && calculations['pool_margin'] >= settings['min_margin']){
					rigsToRent.push(goodRigs[i]);
					totalNewHash += parseFloat(goodRigs[i].hashrate);
					totalCost += parseFloat(goodRigs[i].price_hr)*settings['rental_length_hrs'];
					calculations['pool_hashrate'] = parseInt(calculations['pool_hashrate']) + parseInt(goodRigs.hashrate);
					goodRigs.splice(i, 1);
					updateCalculations();
				}
			}
			for (var i = 0; i < goodRigs.length; i++) {
				if (goodRigs[i].rpi > settings['RPI_threshold'] && (totalCost + parseFloat(goodRigs[i].price_hr)) <= ((settings['weekly_budget_btc']/168)*settings['rental_length_hrs']) && calculations['pool_margin'] >= settings['min_margin']){
					rigsToRent.push(goodRigs[i]);
					totalNewHash += parseFloat(goodRigs[i].hashrate);
					totalCost += parseFloat(goodRigs[i].price_hr)*settings['rental_length_hrs'];
					calculations['pool_hashrate'] = parseInt(calculations['pool_hashrate']) + parseInt(goodRigs.hashrate);
					updateCalculations();
				}
			}

			console.log(rigsToRent);
			console.log("Hashrate to Rent: " + (totalNewHash / 1000000000));
			console.log("Cost to Rent: " + totalCost);

			var MRRAPI = new MiningRigRentalsAPI(settings.MRR_API_key, settings.MRR_API_secret);

			if (rigsToRent.length != 0){
				MRRAPI.getBalance(function(error, response){
					if (error){
						throwError('Error getting balance from MiningRigRentals!', error);
						return;
					}

					console.log(response);
					if (!JSON.parse(response).success){
						throwError('Error getting balance, ' + JSON.parse(response).message);
						return;
					}
					var balance = JSON.parse(response)['data']['confirmed'];
					log('info', 'Current balance is: ' + balance, response);
					log('curbal', balance, '', 'balance');
					if (parseFloat(balance) > totalCost){
						for (var i = 0; i < rigsToRent.length; i++) {
							console.log(rigsToRent[i]);
							var args = {'id': parseInt(rigsToRent[i].id), 'length': settings.rental_length_hrs, 'profileid': settings.profileid};
							console.log(args);
							MRRAPI.rentRig(args, function(error, response){
								if (error){
									throwError('Error renting rig!', error + '\n' + response);
								}
								response = JSON.parse(response);
								log('rental', 'Successfully rented rig: "' + response.data.rigid + '" for ' + response.data.price + ' BTC', JSON.stringify(response));
								log('spend', response.data.price, JSON.stringify(response), 'balance');
							});
						}
					} else {
						throwError('Not enough balance in wallet to rent miners!');
					}
				});
			}
			} else {
				throwError('Error getting rig list from MiningRigRentals!', error + '\n' + response + '\n' + body);
			}
	})
}
var busy = false;
function log(type, message, extrainfo, table){
	if (!extrainfo)
		extrainfo = '';

	if (!table)
		table = 'log';

	if (table == 'log')
		var cols = '(timestamp, type, message, extrainfo)';
	else if (table == 'balance')
		var cols = '(timestamp, type, amount, extrainfo)'

	// Store log in database
	db.serialize(function() {
		db.run("INSERT INTO " + table + " " + cols + " VALUES (" + parseInt(Date.now() / 1000) + ",'" + type + "', '" + message + "', '" + extrainfo + "');");
	});
}

function throwError(message, extraInfo){
	if (!extraInfo)
		extraInfo = '';

	log('error', message, extraInfo, 'log');

	console.log(message);
	console.log(extraInfo);
}

function loadConfig(){
	if (!fs.existsSync(__dirname + '/settings.cfg'))
		copyFile(__dirname + '/settings.example.cfg', __dirname + '/settings.cfg');

	var data = fs.readFileSync(__dirname + '/settings.cfg');
	try {
		if (data == ''){
			copyFile(__dirname + '/settings.example.cfg', __dirname + '/settings.cfg');
			var data = fs.readFileSync(__dirname + '/settings.cfg');
		}
		settings = JSON.parse(data);
	} catch(e) {
		throwError('Error loading Config', 'There was an error loading the config, please double check that it is correctly written and valid JSON!\n' + e);
	}
}

function writeConfig(settings){
	try {
		fs.writeFileSync(__dirname + '/settings.cfg', JSON.stringify(settings, null, 4));
	} catch (e) {
		throwError('Error writing config', e);
	}

}

function copyFile(source, target) {
	try {
		var data = fs.readFileSync(source);
		fs.writeFileSync(target, data);
	} catch (e) {
		throwError('Error creating default settings file from settings.example.cfg', e);
	}
}

loadConfig();
// Initially update endpoint data on startup
//updateEnpointData();
// 								 minutes * seconds * ms
//setInterval(updateEnpointData, 60 * 60 * 1000);

app.listen(3000, function () {
	console.log('autominer-api listening on port 3000!');
	log('info', 'Started up autominer-api on port 3000');
});