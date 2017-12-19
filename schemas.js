/**
 * Schema for messages to exchange ICE candidates.
 */
exports.schemaCandidate = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    candidate: {}
  },
  required: [
    'from',
    'to',
    'candidate'
  ]
};

/**
 * Schema for messages to exchange SDP descriptions.
 */
exports.schemaSdp = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    sdp: {}
  },
  required: [
    'from',
    'to',
    'sdp'
  ]
};
