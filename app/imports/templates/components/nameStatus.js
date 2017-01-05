import { registrar } from '/imports/lib/ethereum';

Template['components_nameStatus'].onCreated(function() {
    TemplateVar.set('error', false);
    this.autorun(function() {
      var searched = Session.get('searched');
      TemplateVar.set('error', false);
      if (searched) {
        //Look up name on 'searched' change.
        try {
          registrar.getEntry(searched, (err, entry) => {
            if(!err && entry) {
              TemplateVar.set('nameInfo', {
                name: entry.name + '.eth',
                entry
              })

              TemplateVar.set('name', entry.name);
              TemplateVar.set('status', 'status-' + entry.mode);
              TemplateVar.set('aside', 'aside-' + entry.mode);
              Session.set('name', entry.name);
            }
          });
        } catch(e) {
          TemplateVar.set('error', e);
        }
        
      }
    })
});


Template['components_nameStatus'].helpers({
    searched() {
      return Session.get('searched');
    },
    fullName() {
      //searched + .eth
      return TemplateVar.get('nameInfo').name
    }
});


Template['aside-can-invalidate'].helpers({
  value() {
    var val = Template.instance().data.entry.deed.balance;
    return web3.fromWei(val.toFixed(), 'ether');
  },
  invalidatorFee() {
    var val = Template.instance().data.entry.deed.balance;
    return web3.fromWei(val.toFixed()/2, 'ether');
  }
})