# Autominer API
Automatically rent miners based on the current cost to mine the currency. You should run the frontend and only make calls from an SSL connection if including the API key. If you do not use an SSL secure connection you will be risking exposing your API keys to anybody who might be sniffing your traffic.

## Installation
Install Node.js then run the following commands to download and install the autominer-api.
```
$ git clone https://github.com/dloa/autominer-api.git
$ cd autominer-api
$ npm install
```

# Usage
## Running the Application
To run the autominer-api application just run the following command and keep it running using something like screen.
```
$ node app.js
```

## API Endpoints:
`/info`: Responds with JSON that includes the following data:
```javascript
{
	'pool_hashrate': 978670933, 		// The current hashrate of the Alexandria Pool
	'networkhashps': 1974515030, 		// Current hashrate of all florincoin miners
	'MiningRigRentals_last10': 0.00014861, // Average cost per hash for an hour from the last 10 rented miners
	'fmd_weighted_btc': 0.00000325, 	// Value per FLO in BTC
	'fmd_weighted_usd': 0.00144, 		// Value per FLO in USD
	'flo_spotcost_btc': 0.00000543, 	// Cost to mine 1 FLO in BTC
	'flo_spotcost_usd': 0.00241, 		// Cost to mine 1 FLO in USD
	'pool_influence': 0.9828, 			// Amount of the entire Hashrate that the pool controls (1 = 50%)
	'pool_influence_code': 0, 			// 0: Pool influence below 50%, 1: Pool influence over 50%
	'pool_influence_multiplier': 1, 	// if pool_influence_code = 0 { pool_influence_multiplier = 1 } 
											//else if pool_infleunce_code = 1 { pool_influence_multiplier = 1 / ( pool_influence^2) }	
	'market_conditions': 1.0064, 		// (((((Pool_Max_Margin / 100) + 1) x flo_spotcost_btc) - fmd_weighted_btc) ÷ fmd_weighted_btc)	
	'market_conditions_code': 2,		// if market_conditions ≤ 0 { market_conditions_code = “0: Market conditions support Max Pool margin” }
											// else if market_conditions > 0 and ≤ 1 { market_conditions_code = “1: Max Pool margin too high for market conditions” }
											// else if market_conditions > 1 { market_conditions_code = “2: Any Pool margin too high for market conditions”}
	'market_conditions_multiplier': 0,	// if market_conditions_code=0, market_conditions_multiplier = 1
											// else if market_conditions_code=1, market_conditions_multiplier = 1-(market_conditions^.5)
											// else if market_conditions_code=2, market_conditions_multiplier = 0
	'pool_margin': 0, 					// Pool_Max_Margin x Pool_Influence_Multiplier x Market_Conditions_Multiplier
	'offer_btc': 0.00000543 			// Current BTC offer based on the cost for 1 FLO plus margins
}
```
`/status`: Requires the post of an API key, responds with JSON that includes the following data from the status of ongoing rentals:
```javascript
{
	'hash_rented': 191879347, 		// Current hashrate
	'week_spent_btc': 0.4872, 		// Amount of BTC spent in the current week
	'account_balance': 0.1874123, 	// Current account balance
	'hash_history': [				// History of the hashrate, contains up to 168 hourly records.
		{
			'time': 1467067237,
			'hashrate': 1762487,
			'machines_rented': [
				{
					'name': 'The Beast',
					'hash': 716274,
					'cost_per_hour': 0.0015
				}
			]
		}
	]
}
```
`/config`: Requires the post of an API key in order to get config info, you can post any variables below in order to change them. Responds with JSON that includes the following data from the current config:
```javascript
{
	'weekly_budget_btc': 1, // Maximum budget to spend per week in BTC
	'min_margin': 10,		// Margin that you wish to make by mining
	'RPI_threshold': 80		// Minimum RPI allowed for renting devices
	'api_key': '8uuijau898ue9823uj29iu8d',
	'MRR_API_key': 'd448a54df68a8sd8f48as4d8f7e6ad48745ds52a1f234',
	'MRR_API_secret': '4574a1s6d84654as86d4fga8447d8s4ad8a4gf8a4s56'
}
```
`/logs`: Requires the post of an API key in order to get logs, you can post a variable called 'amount' to specify how many logs you want. Default amount to return is 50 unless specified, -1 will return all. Responds with logs like this:
```javascript
{
  "amount": 2,
  "logs": [{
      "id": 2,
      "timestamp": 1469389445,
      "type": "info",
      "message": "Started up autominer-api on port 3000",
      "extrainfo": ""
    },
    {
      "id": 1,
      "timestamp": 1469389445,
      "type": "error",
      "message": "Error creating default settings file from settings.example.cfg",
      "extrainfo": "error"
    }
  ]
}
```

### Example Config Change
Change the config by posting to the config url:
```
$.post('127.0.0.1/config', JSON.stringify({
	key:"kjh87uyh9i3yhu98ayui0938u", 
	weekly_budget_btc: 0.5,
	min_margin: 25,
	RPI_threshold: 75
}));
```
