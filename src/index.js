const interfaces = require('./interfaces.js');

const ENS = require('ethereum-ens');

const namehash = ENS.prototype.namehash;
const normalise = ENS.prototype.normalise;


/**
 * Constructs a new Registrar instance, providing an easy-to-use interface
 * to the [Auction Registrar][docs], which governs the `.eth` namespace.
 *
 * The registrar specification is [here][eip162], and the mechanics of the
 * auction are also outlined [here][mediumPost]
 *
 * ### Example usage:
 *
 *     var Registrar = require('eth-registrar-ens');
 *     var Web3 = require('web3');
 *
 *     var web3 = new Web3();
 *     web3.setProvider(new web3.providers.HttpProvider('http://localhost:8545'));
 *
 * The public ENS is deployed on Ropsten at
 * `0x112234455c3a32fd11230c42e7bccd4a84e02010`, and will be at the same
 * address when deployed on the Ethereum Main net. This package imports the
 * [`ethereum-ens`](https://www.npmjs.com/package/ethereum-ens) package, and
 * defaults to the public ENS address, so all that is needed to construct it is
 * `[web3](https://www.npmjs.com/package/web3)`. The rest is optional.
 *
 *     var registrar = new Registrar(web3);
 *
 * If you are working with another instance of the ENS, you will need to
 * instantiate your own 'ethereum-ens' object with the correct address. You
 * can also specify a custom TLD, and minimum character length for valid names.
 *
 *     var ENS = require('ethereum-ens');
 *     var yourEnsAddress = '0x0dfc1...'
 *     var ens = new ENS(web3, address)
 *     var registrar = new Registrar(web3, ens, 'yourTLD', 0);
 *
 *     var name = 'foobarbaz';
 *     registrar.startAuction(name);
 *
 *     var owner = web3.eth.accounts[0]
 *     var value = web3.toWei(1, 'ether');
 *
 *     // generate a sealed bid
 *     var bid = registrar.shaBid(name, owner, value, 'secret');
 *
 *     // submit a bid, and a deposit value. The parameters of your true bid are secret.
 *     var deposit = web3.toWei(2, 'ether');
 *     registrar.newBid(bid, {value: deposit});
 *
 *     // reveal your bid during the reveal period
 *     registrar.unsealBid(name, owner, value, 'secret');
 *
 *     // After the registration date has passed, assign ownership of the name
 *     // in the ENS. In this case, the highest bidder would now own 'foobarbaz.eth'
 *     registrar.finalizeAuction(name);
 *
 *
 * Throughout this module, the same optionally-asynchronous pattern as web3 is
 * used: all functions that call web3 take a callback as an optional last
 * argument; if supplied, the function returns nothing, but instead calls the
 * callback with (err, result) when the operation completes.
 *
 * Functions that create transactions also take an optional 'options' argument;
 * this has the same parameters as web3.
 *
 * [docs]: http://docs.ens.domains/en/latest/auctions.html
 * [eip162]: https://github.com/ethereum/EIPs/issues/162
 * [mediumPost]: https://medium.com/@_maurelian/explaining-the-ethereum-namespace-auction-241bec6ef751#.tyzb7qlfv
 *
 * @author J Maurelian
 * @date 2016
 * @license LGPL
 *
 * @param {object} web3 A web3 instance to use to communicate with the blockchain.
 * @param {address} address The address of the registrar.
 * @param {integer} minLength The minimum length of a name require by the registrar.
 * @param {string} tld The top level domain
 * @param {string} ens The address of the ENS instance
 */
function Registrar(web3, ens = new ENS(web3), tld = 'eth', minLength = 7) {
  this.web3 = web3;

  // prior to version 0.16, web3.sha3 didn't prepend '0x', to support both options
  // here we attach a sha3 method to the registrar object, and ensure that it
  // always prepends '0x'
  this.sha3 = function sha3withZeroX(...args) {
    const result = web3.sha3.apply(this, args);
    if (result[1] !== 'x') {
      return `0x${result}`;
    }
    return result;
  };

  this.ens = ens;
  this.tld = tld;
  this.minLength = minLength;
  this.address = this.ens.owner(this.tld);
  this.contract = this.web3.eth.contract(interfaces.registrarInterface).at(this.address);
  this.rootNode = namehash(this.tld);
}

Registrar.TooShort = Error('Name is too short');

Registrar.prototype.checkLength = function checkLength(name) {
  if (name.length < this.minLength) {
    throw Registrar.TooShort;
  }
};


/**
 * Constructs a new Entry object corresponding to a name.
 *
 * @ignore
 *
 * @param {string} name The unhashed name
 * @param {string} hash
 * @param {number} status
 * @param {address} deed
 * @param {number} registrationDate
 * @param {number} value
 * @param {number} highestBid
 */
function Entry(name, hash, status, deed, registrationDate, value, highestBid) {
  // TODO: improve Entry constructor so that unknown names can be handled via getEntry
  this.name = name;
  this.hash = hash;
  this.status = status;
  this.deed = deed;
  this.registrationDate = registrationDate;
  this.value = value;
  this.highestBid = highestBid;

  // Check the auction mode

  let mode = '';

  // TODO: make the minimum length dynamic to match the Registrar constructor
  if (name.length < 7) {
    // If name is short, check if it has been bought
    if (this.status === 0) {
      // TODO: Calling this 'invalid' is confusing, it's not the same as 'invalidated'
      mode = 'invalid';
    } else {
      mode = 'can-invalidate';
    }
  } else {
    // If name is of valid length
    if (this.status === 0) { //eslint-disable-line
      // Not an auction yet
      mode = 'open';
    } else if (this.status === 1) {
      const now = new Date();
      const registration = new Date(this.registrationDate * 1000);
      const hours = 60 * 60 * 1000;

      if ((registration - now) > 24 * hours) {
        // Bids are open
        mode = 'auction';
      } else if (now < registration && (registration - now) < 24 * hours) {
        // reveal time!
        mode = 'reveal';
      } else if (now > registration && (now - registration) < 24 * hours) {
        // finalize now
        mode = 'finalize';
      } else {
        // finalize now but can open?
        mode = 'finalize-open';
      }
    } else if (this.status === 2) {
      mode = 'owned';
    }
  }

  this.mode = mode;
}

/**
 * @ignore
 * Construct a deed object.
 */
function Deed(address, balance, creationDate, owner) {
  this.address = address;
  this.balance = balance;
  this.creationDate = creationDate;
  this.owner = owner;
}

/**
 * **Get the properties of a Deed at a given address.**
 *
 * This method is used in the getEntry method, but also available on its own.
 *
 * @memberOf Registrar
 *
 * @param {string} address The address of the deed
 * @return {object} A deed object
 */
Registrar.prototype.getDeed = function getDeed(address) {
  const d = this.web3.eth.contract(interfaces.deedInterface).at(address);
  const balance = this.web3.eth.getBalance(address);
  return new Deed(d.address, balance, d.creationDate(), d.owner());
};


/**
 * **Get the properties of the entry for a given a name.**
 *
 * @example
 * registrar.getEntry('foobarbaz');
 * // registrar.getEntry('insurance');
 * // { name: 'insurance',
 * //   hash: '0x73079a5cb4c7d259f40c6d0841629e689d2a95b85883b371e075ffb2f329c3e1',
 * //   status: 2,
 * //   deed:
 * //    { address: '0x268e06911ba1ddc9138b355f9b42711abbc6eaec',
 * //      balance: { s: 1, e: 18, c: [Object] },
 * //      creationDate: { s: 1, e: 9, c: [Object] },
 * //      owner: '0x8394a052eb6c32fb9defcaabc12fcbd8fea0b8a8' },
 * //   registrationDate: 1481108206,
 * //   value: 5000000000000000000,
 * //   highestBid: 11100000000000000000,
 * //   mode: 'owned' }
 *
 * @memberOf Registrar.prototype
 * @param {string} input The name or hash to get the entry for
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 *
 * @returns {object} An Entry object
 */
Registrar.prototype.getEntry = function getEntry(input, callback) {
  // Accept either a name or a hash
  let hash = input;
  // if the input is a hash, we'll use that for the name in the entry object
  let name = input;
  // if the input is a name
  if (input.substring(0, 2) !== '0x') {
    name = normalise(input);
    hash = this.sha3(name);
  }

  const e = this.contract.entries(hash);
  let deed;

  if (e[1] !== '0x0000000000000000000000000000000000000000') {
    //
    deed = this.getDeed(e[1]);
  } else {
    // construct a deed object with all props null except for the 0 address
    deed = new Deed(e[1], null, null, null);
  }

  const entry = new Entry(
    name,
    hash,
    e[0].toNumber(),
    deed,
    e[2].toNumber(),
    e[3].toNumber(),
    e[4].toNumber()
  );

  if (callback) {
    callback(null, entry);
  } else {
    return entry;
  }
};

/**
 * **Open an auction for the desired name**
 *
 * This method also opens auctions on several other randomly
 * generated hashes, helping to prevent other bidders from guessing which
 * names you are interested in.
 *
 * @example
 * var name = 'foobarbaz';
 * registrar.openAuction(name, { from: web3.eth.accounts[0] });
 * @param {string} name The name to start an auction on
 * @param {object} params An optional transaction object to pass to web3.
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 *
 * @returns {string} The transaction ID if callback is not supplied.
 */
Registrar.prototype.openAuction = function openAuction(name, params = {}, callback = null) {
  // Generate an array of random hashes
  const randomHashes = new Array(10);
  for (let i = 0; i < randomHashes.length; i++) {
    randomHashes[i] = this.sha3(Math.random().toString());
  }
  // Randomly select an array entry to replace with the name we want
  const j = Math.floor(Math.random() * 10);

  if (callback) {
    try {
      // normalise throws an error if it detects an invalid character
      const normalisedName = normalise(name);
      this.checkLength(name);
      const hash = this.sha3(normalisedName);
      // Insert the hash we're interested in to the randomly generated array
      randomHashes[j] = hash;
      // if either normalise or checkLength throw an error, this line won't be called.
      this.contract.startAuctions(randomHashes, params, callback);
    } catch (e) {
      callback(e, null);
    }
  } else {
    const normalisedName = normalise(name);
    this.checkLength(name);

    const hash = this.sha3(normalisedName);
    // Insert the hash we're interested in to the randomly generated array
    randomHashes[j] = hash;
    return this.contract.startAuctions(randomHashes, params);
  }
};

Registrar.NoDeposit = Error('You must specify a deposit amount greater than the value of your bid');

/**
 * **Construct a Bid object.**
 *
 * The properties of the Bid object correspond to the
 * inputs of the registrar contract's 'shaBid' function.
 * When a bid is submitted, these values should be saved so that they can be
 * used to reveal the bid params later.
 *
 * @example
 * myBid = registrar.bidFactory(
 *   'foobarbaz',
 *   web3.eth.accounts[0],
 *   web3.toWei(2, 'ether'),
 *   'secret'
 * );
 *
 * @param {string} name The name to be bid on
 * @param {string} owner An owner address
 * @param {number} value The value of your bid in wei
 * @param {secret} secret An optional random value
 * @returns {object} A bid object containing the parameters of the bid
 * required to unseal the bid.
 */
Registrar.prototype.bidFactory = function bidFactory(name, owner, value, secret) {
  this.checkLength(name);
  const sha3 = this.sha3;
  const normalisedName = normalise(name);
  const bidObject = {
    name: normalisedName,
    // TODO: consider renaming any hashes to  `this.node`
    hash: sha3(normalisedName),
    value,
    owner,
    secret,
    hexSecret: sha3(secret),
    // Use the bid properties to get the shaBid value from the contract
    shaBid: this.contract.shaBid(sha3(normalisedName), owner, value, sha3(secret))
  };
  return bidObject;
};


/**
 * **Submit a sealed bid and deposit.**
 *
 * @example
 *
 * registrar.submitBid(highBid,
 *      { from: accounts[0], value: web3.toWei(1, 'ether'), gas: 4700000 }
 *  );
 *
 * @param {object} bid A Bid object.
 * @param {object} params An optional transaction object to pass to web3. The
 * value sent must be at least as much as the bid value.
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 * @return The transaction ID if callback is not supplied.
 */
// TODO: should also open some new random hashes to obfuscate bidding activity
Registrar.prototype.submitBid = function submitBid(bid, params = {}, callback = null) {
  if (callback) {
    if (params.value < bid.value) {
      callback(Registrar.NoDeposit, null);
    } else {
      this.contract.newBid(bid.shaBid, params, callback);
    }
  } else {
    if (params.value < bid.value) {
      throw Registrar.NoDeposit;
    }
    return this.contract.newBid(bid.shaBid, params);
  }
};


/**
 * **Unseal your bid during the reveal period**
 *
 * During (or non-ideally before) the reveal period (final 48 hours) of the auction,
 * you must submit the parameters of a bid. The registrar contract will generate
 * the bid string, and associate the bid parameters with the previously submitted bid string
 * and deposit. If you have not already submitted a bid string, the registrar
 * will throw. If your bid is revealed as the current highest; the difference
 * between your deposit and bid value will be returned to you, and the
 * previous highest bidder will have their funds returned. If you are not the
 * highest bidder, all your funds will be returned. Returns are sent to the
 * owner address listed on the bid.
 *
 * @example
 * registrar.unsealBid(myBid, { from: accounts[1], gas: 4700000 });
 *
 * @param {string} bid A bid object
 * @param {object} params An optional transaction object to pass to web3.
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 *
 * @returns {string} The transaction ID if callback is not supplied.
 */
Registrar.prototype.unsealBid = function unsealBid(bid, params = {}, callback = null) {
  if (callback) {
    this.contract.unsealBid(bid.hash, bid.owner, bid.value, bid.hexSecret, params, callback);
  } else {
    return this.contract.unsealBid(bid.hash, bid.owner, bid.value, bid.hexSecret, params);
  }
};

/**
 * **Verify that your bid has been successfully revealed**
 *
 * Returns a boolean indicating if a bid object, as generated by bidFactory,
 * is revealed or not.
 *
 * @example
 * registrar.isBidRevealed(myBid);
 *
 * @param {string} bid A bid object
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 *
 * @returns {boolean} Whether or not the bid was revealed.
 */
Registrar.prototype.isBidRevealed = function isBidRevealed(bid, callback) {
  if (callback) {
    this.contract.sealedBids.call(bid.shaBid, (err, result) => {
      if (err) {
        return callback(err);
      }
      // sealedBid's deed should be deleted
      callback(null, result === '0x0000000000000000000000000000000000000000');
    });
  } else {
    return this.contract.sealedBids.call(bid.shaBid) ===
      '0x0000000000000000000000000000000000000000';
  }
};

/**
 * **Finalize the auction**
 *
 * After the registration date has passed, calling finalizeAuction
 * will set the winner as the owner of the corresponding ENS subnode.
 *
 * @example
 * registrar.finalizeAuction('foobarbaz', { from: accounts[1], gas: 4700000 })
 *
 * @param {string} name
 * @param {object} params An optional transaction object to pass to web3.
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 *
 * @returns {string} The transaction ID if callback is not supplied.
 */
Registrar.prototype.finalizeAuction = function finalizeAuction(name, params = {}, callback = null) {
  const normalisedName = normalise(name);
  const hash = this.sha3(normalisedName);

  if (callback) {
    this.contract.finalizeAuction(hash, params, callback);
  } else {
    return this.contract.finalizeAuction(hash, params);
  }
};

/**
 * __Not yet implemented__
 * The owner of a domain may transfer it, and the associated deed,
 * to someone else at any time.
 *
 * @param {string} name The node to transfer
 * @param {string} newOwner The address to transfer ownership to
 * @param {object} options An optional transaction object to pass to web3.
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 *
 * @returns {string} The transaction ID if callback is not supplied.
 */
Registrar.prototype.transfer = function transfer() {
};

/**
 * __Not yet implemented__
 * After one year, the owner can release the property and get their ether back
 *
 * @param {string} name The name to release
 * @param {object} options An optional transaction object to pass to web3.
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 *
 * @returns {string} The transaction ID if callback is not supplied.
 */
Registrar.prototype.releaseDeed = function releaseDeed() {

};

/**
 * __Not yet implemented__
 * Submit a name 6 characters long or less. If it has been registered,
 * the submitter will earn a portion of the deed value, and the name will be updated
 *
 * @param {string} name An invalid name to search for in the registry.
 * @param {object} options An optional transaction object to pass to web3.
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 *
 * @returns {string} The transaction ID if callback is not supplied.
 */
Registrar.prototype.invalidateName = function invalidateName() {

};


/**
 * __Not yet implemented__
 * Transfers the deed to the current registrar, if different from this one.
 * Used during the upgrade process to a permanent registrar.
 *
 * @param name The name to transfer.
 * @param {object} options An optional transaction object to pass to web3.
 * @param {function} callback An optional callback; if specified, the
 *        function executes asynchronously.
 *
 * @returns {string} The transaction ID if callback is not supplied.
 */
Registrar.prototype.transferRegistrars = function transferRegistrars() {

};

module.exports = Registrar;