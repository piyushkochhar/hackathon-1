const _data = require('./data');
const https = require('https');
const http = require('http');
const url = require('url');
const helpers = require('./helpers');
const workers = {};

workers.gatherAllChecks = () => {
  //Get all the checks that are available in checks folder created by all users
  _data.list('checks', (err, checks) => {
    if (!err && checks && checks.length > 0) {
      checks.forEach((check) => {
        //Read the check data (individual file)
        _data.read('checks', check, (err, originalCheckData) => {
          if (!err && originalCheckData) {
            //Now lets pass the originaCheckData to another validation function
            workers.validateCheckData(originalCheckData);
          } else {
            console.error('Error Reading one of the checks file data');
          }
        });
      });
    } else {
      //Take the first exist as per our flow chart
      console.log(
        'There are no checks to perform at this moment ' + new Date().toString()
      );
    }
  });
};

//Data Validation for check file
workers.validateCheckData = (originalCheckData) => {
  originalCheckData =
    typeof originalCheckData === 'object' && originalCheckData !== null
      ? originalCheckData
      : {};

  originalCheckData.id =
    typeof originalCheckData.id === 'string' &&
    originalCheckData.id.trim().length === 20
      ? originalCheckData.id.trim()
      : false;

  originalCheckData.userPhone =
    typeof originalCheckData.userPhone === 'string' &&
    originalCheckData.userPhone.trim().length === 10
      ? originalCheckData.userPhone.trim()
      : false;

  originalCheckData.protocol =
    typeof originalCheckData.protocol === 'string' &&
    ['http', 'https'].indexOf(originalCheckData.protocol) > -1
      ? originalCheckData.protocol
      : false;

  originalCheckData.url =
    typeof originalCheckData.url === 'string' &&
    originalCheckData.url.trim().length > 0
      ? originalCheckData.url.trim()
      : false;

  originalCheckData.method =
    typeof originalCheckData.method === 'string' &&
    ['post', 'get', 'put', 'delete'].indexOf(originalCheckData.method) > -1
      ? originalCheckData.method
      : false;

  originalCheckData.successCodes =
    typeof originalCheckData.successCodes === 'object' &&
    originalCheckData.successCodes instanceof Array &&
    originalCheckData.successCodes.length > 0
      ? originalCheckData.successCodes
      : false;

  originalCheckData.timeoutSeconds =
    typeof originalCheckData.timeoutSeconds === 'number' &&
    originalCheckData.timeoutSeconds % 1 === 0 &&
    originalCheckData.timeoutSeconds >= 1 &&
    originalCheckData.timeoutSeconds <= 5
      ? originalCheckData.timeoutSeconds
      : false;

  originalCheckData.state =
    typeof originalCheckData.state === 'string' &&
    ['up', 'down'].indexOf(originalCheckData.state) > -1
      ? originalCheckData.state
      : 'down';

  originalCheckData.lastChecked =
    typeof originalCheckData.lastChecked === 'number' &&
    originalCheckData.lastChecked > 0
      ? originalCheckData.lastChecked
      : false;

  if (
    originalCheckData.id &&
    originalCheckData.userPhone &&
    originalCheckData.protocol &&
    originalCheckData.url &&
    originalCheckData.method &&
    originalCheckData.successCodes &&
    originalCheckData.timeoutSeconds
  ) {
    //Proceed to Next Phase
    workers.performCheck(originalCheckData);
  } else {
    console.error(
      'Error : One of the checks file data is not properly formatted. Aborting the checks.'
    );
  }
};

//Perform the check
workers.performCheck = (originalCheckData) => {
  //Prepare the initial check outCome
  let checkOutcome = {
    error: false,
    responseCode: false,
  };
  //Mark the outcome has not been sent yet
  let outcomeSent = false;

  //Trigger the API - logic
  //PArse the hostname and the path out of the originalCheckData
  let parsedUrl = url.parse(
    originalCheckData.protocol + '://' + originalCheckData.url,
    true
  );
  let hostName = parsedUrl.hostname;
  let path = parsedUrl.path; //Please explore path vs pathname

  let requestDetails = {
    protocol: originalCheckData.protocol + ':',
    hostname: hostName,
    method: originalCheckData.method.toUpperCase(),
    path: path,
    timeout: originalCheckData.timeoutSeconds * 1000,
  };
  //Choose which Protocol to req object
  let _moduleToUse = originalCheckData.protocol === 'http' ? http : https;

  let req = _moduleToUse.request(requestDetails, (res) => {
    //Grab the status code
    let status = res.statusCode;
    //Update the checkoutcome and pass the data along
    checkOutcome.responseCode = status;
    if (!outcomeSent) {
      workers.processCheckOutcome(originalCheckData, checkOutcome);
      outcomeSent = true;
    }
  });

  req.on('error', (e) => {
    //Update the checkOutcome
    checkOutcome.error = {
      error: true,
      value: e,
    };
    if (!outcomeSent) {
      workers.processCheckOutcome(originalCheckData, checkOutcome);
      outcomeSent = true;
    }
  });

  req.on('timeout', () => {
    //Update the checkOutcome
    checkOutcome.error = {
      error: true,
      value: 'timeout',
    };
    if (!outcomeSent) {
      workers.processCheckOutcome(originalCheckData, checkOutcome);
      outcomeSent = true;
    }
  });
  req.end();
};

workers.processCheckOutcome = (originalCheckData, checkOutcome) => {
  //Decide if the check is up/down
  let state =
    !checkOutcome.error &&
    checkOutcome.responseCode &&
    originalCheckData.successCodes.indexOf(checkOutcome.responseCode) > -1
      ? 'up'
      : 'down';

  let alertWarranted =
    originalCheckData.lastChecked && originalCheckData.state !== state
      ? true
      : false;
  let newCheckData = originalCheckData;
  newCheckData.state = state;
  newCheckData.lastChecked = Date.now();

  //Save the updates into file disk
  _data.update('checks', newCheckData.id, newCheckData, (err) => {
    if (!err) {
      //Send the new check Data to next phase
      if (alertWarranted) {
        workers.alertUserToStatusChange(newCheckData);
      } else {
        console.log(
          'Check Outcome has not changed. No need to alert user with sms/email'
        );
      }
    } else {
      console.error(
        'Error in updating the checks record. Check your APIs once.'
      );
    }
  });
};
//Trigger the SMS Alert
workers.alertUserToStatusChange = (newCheckData) => {
  let msg =
    'Alert : Your check for ' +
    newCheckData.method.toUpperCase() +
    ' ' +
    newCheckData.protocol +
    '://' +
    newCheckData.url +
    ' is currently ' +
    newCheckData.state;
  helpers.sendTwilioSMS(newCheckData.userPhone, msg, (err) => {
    if (!err) {
      console.log('Success : User Was Notified via SMS');
    } else {
      console.log('Something wrong with Twilio APIs');
    }
  });
};

//Timer to execute the worker - process every minute
workers.loop = () => {
  setInterval(() => {
    workers.gatherAllChecks();
  }, 1000 * 60);
};

workers.init = () => {
  //Execute all the checks created by all the users in checks folder
  workers.gatherAllChecks();
  //Set a Interval and call the loop to do the above process
  workers.loop();
};

module.exports = workers;
