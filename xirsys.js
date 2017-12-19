const _ = require('lodash');
const https = require('https');

/**
 * Sends a request to the Xirsys API to retrieve a set of ICE servers credentials.
 * @return {Promise}
 */
function requestXirsysIceServers(user, passwd) {
  return new Promise(function (resolve, reject) {
    const authStr = new Buffer(user + ':' + passwd).toString('base64');

    const reqOptions = {
      host: 'global.xirsys.net',
      path: '/_turn/simple-webrtc-server',
      method: 'PUT',
      headers: {
        'Authorization': 'Basic ' + authStr
      }
    };

    const httpreq = https.request(reqOptions, function (httpres) {
      var rawRes = '';

      httpres.on('data', function (data) {
        rawRes += data;
      });

      httpres.on('error', function (e) {
        reject(e);
      });

      httpres.on('end', function () {
        const parsedRes = JSON.parse(rawRes);

        if (parsedRes.s !== 'ok') {
          reject(new Error(parsedRes.v));
          return;
        }

        const iceServers = _.map(parsedRes.v.iceServers, function (iceServer) {
          return _.mapKeys(iceServer, function (value, key) {
            return key === 'url' ? 'urls' : key;
          });
        });

        resolve(iceServers);
      });
    });

    httpreq.end();
  });
}

exports.requestXirsysIceServers = requestXirsysIceServers;
