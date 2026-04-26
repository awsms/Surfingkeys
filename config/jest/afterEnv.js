const { toMatchImageSnapshot } = require('jest-image-snapshot');
const { TextDecoder, TextEncoder } = require('util');

expect.extend({ toMatchImageSnapshot });

global.TextDecoder = global.TextDecoder || TextDecoder;
global.TextEncoder = global.TextEncoder || TextEncoder;
