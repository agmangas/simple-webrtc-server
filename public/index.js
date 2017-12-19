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
          if (iceServers && iceServers.length) {
            pcConfig.iceServers = iceServers;
            console.log('Retrieved ICE servers:', pcConfig.iceServers);
          } else {
            console.log('Empty ICE servers configuration (using STUN-only default)');
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

  const socket = io();

  const waitForSocketConn = new Promise(function (resolve, reject) {
    socket.on('connect', function () {
      resolve();
    });

    socket.on('connect_error', function (err) {
      reject(err);
    });

    socket.on('connect_timeout', function (timeout) {
      reject(timeout);
    });
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

  function createOfferAndSetLocalDescription(pc, peerId) {
    pc.createOffer(function (localDescr) {
      console.log('createOffer', localDescr);
      pc.setLocalDescription(localDescr, function () {
        console.log('setLocalDescription', pc.localDescription);
        socket.emit('sdp', {
          to: peerId,
          sdp: pc.localDescription
        });
      }, logError);
    }, logError);
  }

  function setRemoteDescriptionAndCreateAnswer(pc, remoteDescr, peerId) {
    pc.setRemoteDescription(remoteDescr, function () {
      if (pc.remoteDescription.type === 'offer')
        pc.createAnswer(function (desc) {
          console.log('createAnswer', desc);
          pc.setLocalDescription(desc, function () {
            console.log('setLocalDescription', pc.localDescription);
            socket.emit('sdp', {
              to: peerId,
              sdp: pc.localDescription
            });
          }, logError);
        }, logError);
    }, logError);
  }

  function createPeerConnection(peerSocketId, isOffer) {
    console.log('Creating peer connection for', peerSocketId);

    const pc = new RTCPeerConnection(pcConfig);

    pcPeers[peerSocketId] = pc;

    pc.onicecandidate = function (event) {
      console.log('onicecandidate', event);

      if (event.candidate) {
        socket.emit('candidate', {
          to: peerSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.onnegotiationneeded = function () {
      console.log('onnegotiationneeded');

      if (isOffer) {
        createOfferAndSetLocalDescription(pc, peerSocketId);
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

  function listenSocketEvents() {
    socket.on('candidate', function (data) {
      console.log('Message (candidate):', data);
      const pc = getPeerConnectionOrCreate(data.from);
      const iceCandidate = new RTCIceCandidate(data.candidate);
      pc.addIceCandidate(iceCandidate);
    });

    socket.on('sdp', function (data) {
      console.log('Message (sdp):', data);
      const pc = getPeerConnectionOrCreate(data.from);
      const remoteDescr = new RTCSessionDescription(data.sdp);
      setRemoteDescriptionAndCreateAnswer(pc, remoteDescr, data.from);
    });
  }

  function listenJoinRoom() {
    const $btnJoinRoom = $('#join-room');

    $btnJoinRoom.click(function () {
      const room = $('#room').val();

      if (!room) {
        return false;
      }

      socket.emit('join', room, function (errJoin, remoteSocketIds) {
        if (errJoin) {
          console.error('Error joining room:', errJoin);
          return;
        }

        console.log('Joined room:', room);

        $(elInputRoomRow).addClass('hide');
        $(elCurrentRoomRow).find('#current-room').html(room);
        $(elCurrentRoomRow).removeClass('hide');

        const remoteSocketId = _.head(remoteSocketIds);

        if (remoteSocketId) {
          createPeerConnection(remoteSocketId, true);
        }
      });
    });

    $btnJoinRoom.removeClass('disabled');
  }

  getLocalStream()
      .then(setLocalStream)
      .then(waitForICEConfig)
      .then(waitForSocketConn)
      .then(listenSocketEvents)
      .then(listenJoinRoom);
});
