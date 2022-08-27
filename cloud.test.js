
const assert = require('assert');
const { Capability } = require('./cloud');

describe('Capability', function() {

  /* note, Aedes doesn't support mqtt version 5 yet, which is used by Capability,
  hence we can't yet test using an ad-hoc Aedes server. For now just testing
  the bare minimum */
  it('constructs', function(done) {
    const c = new Capability();
    done();
  });
});
