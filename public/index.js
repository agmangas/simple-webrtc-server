$(function () {
  // noinspection JSUnresolvedVariable
  const RTCPeerConnection = window.RTCPeerConnection ||
      window.mozRTCPeerConnection ||
      window.webkitRTCPeerConnection ||
      window.msRTCPeerConnection;

  // noinspection JSUnresolvedVariable
  const RTCSessionDescription = window.RTCSessionDescription ||
      window.mozRTCSessionDescription ||
      window.webkitRTCSessionDescription ||
      window.msRTCSessionDescription;

  // noinspection JSUnresolvedVariable
  navigator.getUserMedia = navigator.getUserMedia ||
      navigator.mozGetUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.msGetUserMedia;

  const pcConfig = {
    iceServers: [{
      urls: 'stun:stun.l.google.com:19302'
    }]
  };

  const waitForICEConfig = new Promise(function (resolve) {
    $.getJSON('/iceservers')
        .done(function (iceServers) {
          if (iceServers.length) {
            pcConfig.iceServers = iceServers;
            console.log('Retrieved ICE servers:', pcConfig.iceServers);
          } else {
            console.log('Empty ICE servers result (using STUN-only default)');
          }
        })
        .fail(function () {
          console.log('Error getting ICE servers (using STUN-only default)');
        })
        .always(function () {
          resolve();
        });
  });

  const pcPeers = {};

  const elSelfView = document.getElementById('self-view');
  const elRemoteView = document.getElementById('remote-view');
  const elRemoteViewContainer = document.getElementById('remote-view-container');
  const elInputRoomRow = document.getElementById('input-room-row');
  const elCurrentRoomRow = document.getElementById('current-room-row');

  const wsUrl = 'wss://' + location.host;
  console.log('Connecting to WS server:', wsUrl);
  const socket = new WebSocket(wsUrl);

  socket.onmessage = function (event) {
    const msg = JSON.parse(event.data);

    console.log('WS message:', msg);

    const handleSdp = function () {
      const pc = getPeerConnectionOrCreate(msg.from);
      const remoteDescr = new RTCSessionDescription(msg.data);
      setRemoteDescriptionAndCreateAnswer(pc, remoteDescr);
    };

    const handleCandidate = function () {
      const pc = getPeerConnectionOrCreate(msg.from);
      const iceCandidate = new RTCIceCandidate(msg.data);
      pc.addIceCandidate(iceCandidate);
    };

    const handleJoinAck = function () {
      if (msg.err) {
        console.error('Error joining room:', msg.err);
        return;
      }

      console.log('Joined room:', msg.data.room);

      $(elInputRoomRow).addClass('hide');
      $(elCurrentRoomRow).find('#current-room').html(msg.data.room);
      $(elCurrentRoomRow).removeClass('hide');

      if (msg.data.peerId) {
        createPeerConnection(msg.data.peerId, true);
      }
    };

    if (msg.msgType === 'sdp') {
      handleSdp();
    } else if (msg.msgType === 'candidate') {
      handleCandidate();
    } else if (msg.msgType === 'join_ack') {
      handleJoinAck();
    }
  };

  const waitForSocketConn = new Promise(function (resolve) {
    const intervalHandle = setInterval(function () {
      if (socket.readyState === 1) {
        clearInterval(intervalHandle);
        resolve();
      }
    }, 200);
  });

  var localStream;

  function logError(err) {
    console.error(err);
  }

  function getLocalStream() {
    return new Promise(function (resolve, reject) {
      navigator.getUserMedia({
        audio: true,
        video: true
      }, function (stream) {
        resolve(stream);
      }, function (err) {
        reject(err);
      });
    });
  }

  function setVideoElementStream(stream, videoElement) {
    try {
      videoElement.srcObject = stream;
    } catch (error) {
      console.log('Unsupported HTMLMediaElement.srcObject:', error);

      if (window.URL) {
        videoElement.src = window.URL.createObjectURL(stream);
      } else {
        videoElement.src = stream;
      }
    }
  }

  function setLocalStream(stream) {
    localStream = stream;
    setVideoElementStream(stream, elSelfView);
    elSelfView.muted = true;
  }

  function createOfferAndSetLocalDescription(pc) {
    pc.createOffer(function (localDescr) {
      console.log('createOffer', localDescr);
      pc.setLocalDescription(localDescr, function () {
        console.log('setLocalDescription', pc.localDescription);
        socket.send(JSON.stringify({
          msgType: 'sdp',
          to: pc.peerId,
          data: pc.localDescription
        }));
      }, logError);
    }, logError);
  }

  function setRemoteDescriptionAndCreateAnswer(pc, remoteDescr) {
    pc.setRemoteDescription(remoteDescr, function () {
      if (pc.remoteDescription.type === 'offer')
        pc.createAnswer(function (desc) {
          console.log('createAnswer', desc);
          pc.setLocalDescription(desc, function () {
            console.log('setLocalDescription', pc.localDescription);
            socket.send(JSON.stringify({
              msgType: 'sdp',
              to: pc.peerId,
              data: pc.localDescription
            }));
          }, logError);
        }, logError);
    }, logError);
  }

  function createPeerConnection(peerId, isOffer) {
    console.log('Creating peer connection for', peerId);

    const pc = new RTCPeerConnection(pcConfig);

    pc.peerId = peerId;

    pcPeers[peerId] = pc;

    pc.onicecandidate = function (event) {
      console.log('onicecandidate', event);

      if (event.candidate) {
        socket.send(JSON.stringify({
          msgType: 'candidate',
          to: pc.peerId,
          data: event.candidate
        }));
      }
    };

    pc.onnegotiationneeded = function () {
      console.log('onnegotiationneeded');

      if (isOffer) {
        createOfferAndSetLocalDescription(pc);
      }
    };

    pc.oniceconnectionstatechange = function (event) {
      console.log('oniceconnectionstatechange', event);
    };

    pc.onsignalingstatechange = function (event) {
      console.log('onsignalingstatechange', event);
    };

    pc.onaddstream = function (event) {
      console.log('onaddstream', event);
      setVideoElementStream(event.stream, elRemoteView);
      $(elRemoteViewContainer).removeClass('hide');
    };

    pc.addStream(localStream);

    return pc;
  }

  function getPeerConnectionOrCreate(fromId) {
    if (_.has(pcPeers, fromId)) {
      return pcPeers[fromId];
    } else {
      return createPeerConnection(fromId, false);
    }
  }

  function listenJoinRoom() {
    const $btnJoinRoom = $('#join-room');

    $btnJoinRoom.click(function () {
      const room = $('#room').val();

      if (!room) {
        return false;
      }

      $btnJoinRoom.addClass('disabled');

      socket.send(JSON.stringify({
        msgType: 'join',
        data: room
      }));
    });

    $btnJoinRoom.removeClass('disabled');
  }

  getLocalStream()
      .then(setLocalStream)
      .then(waitForICEConfig)
      .then(waitForSocketConn)
      .then(listenJoinRoom);
});
