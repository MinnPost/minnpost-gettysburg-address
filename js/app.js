/**
 * Main application file for: minnpost-gettysburg-address
 *
 * This pulls in all the parts
 * and creates the main object for the application.
 */
define('minnpost-gettysburg-address', ['underscore', 'helpers', 'routers'],
  function(_, helpers, routers) {

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

  // Start function
  App.prototype.start = function() {
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
