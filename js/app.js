/**
 * Main application file for: minnpost-gettysburg-address
 *
 * This pulls in all the parts
 * and creates the main object for the application.
 */
define('minnpost-gettysburg-address', ['underscore', 'store', 'helpers', 'routers'],
  function(_, store, helpers, routers) {

  // Word data, embedded here for ease of use
  var words = [
    {
      id: 'liberty',
      word: 'Liberty',
      options: ['Truth', 'Freedom', 'Equality']
    },
    {
      id: 'proposition',
      word: 'proposition',
      options: ['mission', 'fact', 'ideal']
    },
    {
      id: 'battlefield',
      word: 'battlefield',
      options: ['landscape', 'trial', 'challenge']
    },
    {
      id: 'nation',
      word: 'nation',
      options: ['country', 'notion', 'truth']
    },
    {
      id: 'proper',
      word: 'proper',
      options: ['necessary', 'good', 'essential']
    },
    {
      id: 'consecrate',
      word: 'consecrate',
      options: ['preserve', 'commemorate', 'anoint']
    },
    {
      id: 'ground',
      word: 'ground',
      options: ['battlefield', 'sacrifice', 'war']
    },
    {
      id: 'struggled',
      word: 'struggled',
      options: ['fought', 'sacrificed', 'triumphed']
    },
    {
      id: 'unfinished',
      word: 'unfinished',
      options: ['tireless', 'unending', 'monumental']
    },
    {
      id: 'advanced',
      word: 'advanced',
      options: ['proceeded', 'strengthened', 'aided']
    },
    {
      id: 'task',
      word: 'task',
      options: ['battle', 'work', 'trial']
    },
    {
      id: 'devotion',
      word: 'devotion',
      options: ['fervor', 'commitment', 'ardor']
    },
    {
      id: 'freedom',
      word: 'freedom',
      options: ['liberty', 'equality', 'sovereignity']
    },
    {
      id: 'government',
      word: 'government',
      options: ['hopes', 'institution', 'nation']
    },
    {
      id: 'perish',
      word: 'perish',
      options: ['vanish', 'fade', 'wither']
    }
  ];

  // Constructor for app
  var App = function(options) {
    this.options = options;
    this.el = this.options.el;
    if (this.el) {
      this.$el = $(this.el);
    }
  };

  // Extend with helpers
  _.extend(App.prototype, helpers);

  // Add other methods
  _.extend(App.prototype, {
    store: store,
    setStorage: function(value) {
      return store.set('minnpost-gettysburg-address', value);
    },
    getStorage: function() {
      return store.get('minnpost-gettysburg-address');
    },
    clearStorage: function() {
      store.remove('minnpost-gettysburg-address');
    }
  });

  // Start function
  App.prototype.start = function() {
    // Match up words data with answer data
    var answers = this.getStorage();
    words = _.map(words, function(w) {
      if (answers && answers[w.id]) {
        w.answer = answers[w.id];
      }
      return w;
    });

    // Create router
    this.router = new routers.Router({
      app: this,
      words: words
    });

    // Start backbone history
    this.router.start();
  };

  return App;
});
