
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

  it('sets the right version', function(done) {
    process.env.npm_package_version = '1.2.3';
    process.env.npm_package_config_versionNamespace = 'minor';
    const c = new Capability();
    assert.equal(c.version, '1.2');
    done();
  });

});
