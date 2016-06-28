var express = require('express');
var request = require('request');
var app = express();

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

app.get('/', function (req, res) {
  	res.send('');
});

app.get('/info', function (req, res) {
  	res.send(calculations);
});

function updateEnpointData(){
	// Request data async from each endpoint. When all four have been queried then update the calculations.
	var alexandriaPool = false;
	var florincoinInfo = false;
	var miningRigs = false;
	var libraryd = false;

	request('http://pool.alexandria.media/api/stats', function (error, response, body) {
	  	if (!error && response.statusCode == 200) {
	    	calculations['pool_hashrate'] = JSON.parse(body)['pools']['florincoin']['hashrate'];
	    	alexandriaPool = true;
	    	if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
	    		updateCalculations();
	  	} else {
	  		console.log('Error! ' + error);
	  		console.log(response);
	  		console.log(body);
	  	}
	})

	request('http://florincoin.alexandria.io/getMiningInfo', function (error, response, body) {
	  	if (!error && response.statusCode == 200) {
	    	calculations['fbd_networkhashps'] = JSON.parse(body)['networkhashps'];
	    	florincoinInfo = true;
	    	if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
	    		updateCalculations();
	  	} else {
	  		console.log('Error! ' + error);
	  		console.log(response);
	  		console.log(body);
	  	}
	})

	request('https://www.miningrigrentals.com/api/v1/rigs?method=list&type=scrypt', function (error, response, body) {
	  	if (!error && response.statusCode == 200) {
	    	calculations['MiningRigRentals_last10'] = parseFloat(JSON.parse(body)['data']['info']['price']['last_10']);
	    	miningRigs = true;
	    	if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
	    		updateCalculations();
	  	} else {
	  		console.log('Error! ' + error);
	  		console.log(response);
	  		console.log(body);
	  	}
	})

	request('https://api.alexandria.io/flo-market-data/v1/getAll', function (error, response, body) {
	  	if (!error && response.statusCode == 200) {
	    	calculations['fmd_weighted_btc'] = parseFloat(JSON.parse(body)['weighted']);
	    	calculations['fmd_weighted_usd'] = parseFloat(JSON.parse(body)['USD']);
	    	libraryd = true;
	    	if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
	    		updateCalculations();
	  	} else {
	  		console.log('Error! ' + error);
	  		console.log(response);
	  		console.log(body);
	  	}
	})
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

	console.log(calculations);
}

updateEnpointData();

app.listen(3000, function () {
	console.log('Example app listening on port 3000!');
});