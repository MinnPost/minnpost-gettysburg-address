

/**
 * Helpers to extend to an app.
 */
define('helpers', ['jquery', 'underscore', 'Backbone'],
  function($, _, Backbone) {

  return {
    /**
     * Formats number
     */
    formatNumber: function(num, decimals) {
      decimals = (_.isUndefined(decimals)) ? 2 : decimals;
      var rgx = (/(\d+)(\d{3})/);
      split = num.toFixed(decimals).toString().split('.');

      while (rgx.test(split[0])) {
        split[0] = split[0].replace(rgx, '$1' + ',' + '$2');
      }
      return (decimals) ? split[0] + '.' + split[1] : split[0];
    },

    /**
     * Formats number into currency
     */
    formatCurrency: function(num) {
      return '$' + _.formatNumber(num, 2);
    },

    /**
     * Formats percentage
     */
    formatPercent: function(num) {
      return _.formatNumber(num * 100, 1) + '%';
    },

    /**
     * Formats percent change
     */
    formatPercentChange: function(num) {
      return ((num > 0) ? '+' : '') + _.formatPercent(num);
    },

    /**
     * Converts string into a hash (very basically).
     */
    hash: function(str) {
      return Math.abs(_.reduce(str.split(''), function(a, b) {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
      }, 0));
    },

    /**
     * Returns version of MSIE.
     */
    isMSIE: function() {
      var match = /(msie) ([\w.]+)/i.exec(navigator.userAgent);
      return match ? parseInt(match[2], 10) : false;
    },

    /**
     * Override Backbone's ajax call to use JSONP by default as well
     * as force a specific callback to ensure that server side
     * caching is effective.
     */
    BackboneAJAX: function() {
      var options = arguments;

      if (options[0].dataTypeForce !== true) {
        options[0].dataType = 'jsonp';
        options[0].jsonpCallback = 'mpServerSideCachingHelper' +
          _.hash(options[0].url);
      }
      return Backbone.$.ajax.apply(Backbone.$, options);
    },

    /**
     * Wrapper for a JSONP request
     */
    jsonpRequest: function() {
      var options = arguments[0];

      options.dataType = 'jsonp';
      options.jsonpCallback = 'mpServerSideCachingHelper' +
        _.hash(options.url);
      return $.ajax.apply($, [options]);
    },

    /**
     * Data source handling.  For development, we can call
     * the data directly from the JSON file, but for production
     * we want to proxy for JSONP.
     *
     * `name` should be relative path to dataset minus the .json
     *
     * Returns jQuery's defferred object.
     */
    getLocalData: function(name) {
      var thisApp = this;
      var proxyPrefix = this.options.jsonpProxy;
      var useJSONP = false;
      var defers = [];

      this.data = this.data || {};
      name = (_.isArray(name)) ? name : [ name ];

      // If the data path is not relative, then use JSONP
      if (this.options && this.options.dataPath.indexOf('http') === 0) {
        useJSONP = true;
      }

      // Go through each file and add to defers
      _.each(name, function(d) {
        var defer;
        if (_.isUndefined(thisApp.data[d])) {

          if (useJSONP) {
            defer = this.jsonpRequest({
              url: proxyPrefix + encodeURI(thisApp.options.dataPath + d + '.json')
            });
          }
          else {
            defer = $.getJSON(thisApp.options.dataPath + d + '.json');
          }

          $.when(defer).done(function(data) {
            thisApp.data[d] = data;
          });
          defers.push(defer);
        }
      });

      return $.when.apply($, defers);
    },

    /**
     * Get remote data.  Provides a wrapper around
     * getting a remote data source, to use a proxy
     * if needed, such as using a cache.
     */
    getRemoteData: function(options) {
      options.dataType = 'jsonp';

      if (this.options.remoteProxy) {
        options.url = options.url + '&callback=proxied_jqjsp';
        options.url = app.options.remoteProxy + encodeURIComponent(options.url);
        options.callback = 'proxied_jqjsp';
        options.cache = true;
      }

      return $.ajax(options);
    }
  };
});

/**
 * Models
 */
define('models', ['underscore', 'Backbone', 'helpers'],
  function(_, Backbone, helpers) {
  var models = {};

  // Override backbone's ajax request for use with JSONP
  // which is not preferred but we have to support
  // older browsers
  Backbone.ajax = helpers.BackboneAJAX;

  // Base model
  models.Base = Backbone.Model.extend({
    initialize: function(data, options) {
      // Attach options
      this.options = options || {};
      this.app = options.app;
    }

  });

  // Word
  models.Word = Backbone.Model.extend({
    initialize: function(data, options) {
      models.Word.__super__.initialize.apply(this, arguments);

      // Add options together and randomize
      data.options.push(data.word);
      data.options = _.sample(data.options, data.options.length);
      this.set('options', data.options);

      // Grade now and when answer updated
      this.grade();
      this.on('change:answer', this.grade);
    },

    // Check if correct
    grade: function() {
      this.set('correct', false);
      if (this.get('answer') === this.get('word')) {
        this.set('correct', true);
      }
    }
  });

  // Return what we have
  return models;
});

/**
 * Collections
 */
define('collections', ['underscore', 'Backbone', 'helpers', 'models'],
  function(_, Backbone, helpers, models) {
  var collections = {};

  // Override backbone's ajax request for use with JSONP
  // which is not preferred but we have to support
  // older browsers
  Backbone.ajax = helpers.BackboneAJAX;

  // Base collection
  collections.Base = Backbone.Collection.extend({
    initialize: function(models, options) {
      // Attach options
      this.options = options || {};
      this.app = options.app;

      // Call this in other collections
      //collection.NEWCollection.__super__.initialize.apply(this, arguments);
    }

  });

  // Words
  collections.Words = collections.Base.extend({
    model: models.Word,

    initialize: function(models, options) {
      collections.Words.__super__.initialize.apply(this, arguments);
    }

  });

  // Return what we have
  return collections;
});


/**
 * Views
 *
 * Ractive classes can be extended but we still need a number of
 * things at instantian, like templates
 */
define('views', ['jquery', 'underscore', 'Ractive', 'easydropdown', 'helpers'],
  function($, _, Ractive, easydropdown, helpers) {
  var views = {};

  // Base view to extend from
  views.Base = Ractive.extend({
    baseInit: function(options) {
      this.router = options.router;
      this.app = this.router.app;

      // Clear local storage
      this.on('clearStorage', function(e) {
        e.original.preventDefault();
        this.app.clearStorage();
      });
    }
  });

  // View for application container
  views.Application = views.Base.extend({
    init: function() {
      var thisView = this;
      this.baseInit.apply(this, arguments);

      // Watch for any changes to the words and count correctness
      this.observe('words', function(nV, oV) {
        var words = this.get('words');
        var answers = {};

        // Update word counts
        this.set('wordCount', _.size(words));
        this.set('correctCount', _.reduce(words, function(total, w) {
          return total + (w.get('correct') ? 1 : 0);
        }, 0));

        // Save answer set
        _.each(words, function(w) {
          answers[w.id] = w.get('answer');
        });
        this.app.setStorage(answers);
      });

      // Enable dropdowns if needed.  We have to hack
      // around the answer updating because this (and other
      // libraries) mangle up our original DOM object.
      $(this.el).find('select').easyDropDown({
        onChange: function(selected) {
          thisView.set('words.' + $(this).data('wordId') + '.answer', selected.value);
        }
      });
      // We also have to hack around the fact that the option classes
      // do not carry over
      $(this.el).find('select option').each(function() {
        $option = $(this);
        $option.parent().parent().parent().find('ul li').each(function() {
          $li = $(this);
          if ($li.html() === $option.html()) {
            $li.addClass($option.attr('class'));
          }
        });
      });

      // Show score event
      this.on('showCorrect', function(e) {
        e.original.preventDefault();
        $(this.el).find('.correctness-action').slideUp();
        $(this.el).find('.correctness-score').slideDown();

        _.each(this.data.words, function(w) {
          w.set('graded', true);
        });
      });
    }
  });

  // Return what we have
  return views;
});

define('text!templates/application.mustache',[],function () { return '<div class="message-container"></div>\n\n<div class="content-container">\n\n  <div class="address-text">\n    <p>Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in <span class="word" id="liberty">{{#words.liberty}}{{>word}}{{/words.liberty}}</span>, and dedicated to the <span class="word" id="proposition">{{#words.proposition}}{{>word}}{{/words.proposition}}</span> that all men are created equal.</p>\n\n    <p>Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure. We are met on a great <span class="word" id="battlefield">{{#words.battlefield}}{{>word}}{{/words.battlefield}}</span> of that war. We have come to dedicate a portion of that field, as a final resting place for those who here gave their lives that that <span class="word" id="nation">{{#words.nation}}{{>word}}{{/words.nation}}</span> might live. It is altogether fitting and <span class="word" id="proper">{{#words.proper}}{{>word}}{{/words.proper}}</span> that we should do this.</p>\n\n    <p>But, in a larger sense, we can not dedicate &mdash; we can not <span class="word" id="consecrate">{{#words.consecrate}}{{>word}}{{/words.consecrate}}</span> &mdash; we can not hallow &mdash; this <span class="word" id="ground">{{#words.ground}}{{>word}}{{/words.ground}}</span>. The brave men, living and dead, who <span class="word" id="struggled">{{#words.struggled}}{{>word}}{{/words.struggled}}</span> here, have consecrated it, far above our poor power to add or detract. The world will little note, nor long remember what we say here, but it can never forget what they did here. It is for us the living, rather, to be dedicated here to the <span class="word" id="unfinished">{{#words.unfinished}}{{>word}}{{/words.unfinished}}</span> work which they who fought here have thus far so nobly <span class="word" id="advanced">{{#words.advanced}}{{>word}}{{/words.advanced}}</span>.</p>\n\n    <p>It is rather for us to be here dedicated to the great <span class="word" id="task">{{#words.task}}{{>word}}{{/words.task}}</span> remaining before us &mdash; that from these honored dead we take increased <span class="word" id="devotion">{{#words.devotion}}{{>word}}{{/words.devotion}}</span> to that cause for which they gave the last full measure of devotion &mdash; that we here highly resolve that these dead shall not have died in vain &mdash; that this nation, under God, shall have a new birth of <span class="word" id="freedom">{{#words.freedom}}{{>word}}{{/words.freedom}}</span> &mdash; and that <span class="word" id="government">{{#words.government}}{{>word}}{{/words.government}}</span> of the people, by the people, for the people, shall not <span class="word" id="perish">{{#words.perish}}{{>word}}{{/words.perish}}</span> from the earth.</p>\n  </div>\n\n  <div class="correctness correctness-action">\n    <a href="#" on-tap="showCorrect">Show score</a>.\n  </div>\n\n  <div class="correctness correctness-score">\n    {{ correctCount }} of {{ wordCount }} correct.\n  </div>\n\n</div>\n\n<div class="footnote-container">\n  <div class="footnote">\n    <p>The text of the speech is from the "Collected Works of Abraham Lincoln", edited by Roy P. Basler, republished via  <a href="http://www.abrahamlincolnonline.org/lincoln/speeches/gettysburg.htm" target="_blank">abrahamlincolnonline.org</a>.  Some code, techniques, and data on <a href="https://github.com/zzolo/minnpost-elections-dashboard" target="_blank">Github</a>.</p>\n\n    {{#storage}}\n      <p>Some data is stored locally on your computer\'s web browser for this application.  For privacy or other reasons, you can <a on-tap="clearStorage" href="#" class="storage-clear">clear the locally stored data</a>.</p>\n    {{/storage}}\n  </div>\n</div>\n';});

define('text!templates/loading.mustache',[],function () { return '<div class="loading-container">\n  <div class="loading"><span>Loading...</span></div>\n</div>';});

define('text!templates/word.mustache',[],function () { return '<span class="{{#graded}}graded{{/graded}} {{#(typeof correct != \'undefined\' && correct)}}correct{{/()}}{{#(typeof correct != \'undefined\' && !correct)}}incorrect{{/()}}">\n  <select value="{{ .answer }}" data-word-id="{{ id }}" class="dropdown">\n    <option class="label" selected disabled>&nbsp;</option>\n    {{#options:i}}\n      <option class="{{#(. == word)}}correct-answer{{/()}}" value="{{.}}">{{.}}</option>\n    {{/options}}\n  </select>\n</span>\n';});

/**
 * Routers
 */
define('routers', [
  'underscore', 'Backbone', 'Ractive', 'Ractive-Backbone',
  'helpers', 'models', 'collections', 'views',
  'text!templates/application.mustache',
  'text!templates/loading.mustache',
  'text!templates/word.mustache'
], function(_, Backbone, Ractive, RactiveBackbone,
    helpers, models, collections, views,
    tApplication, tLoading, tWord) {
  var routers = {};

  // Base model
  routers.Router = Backbone.Router.extend({
    views: {},
    collections: {},
    models: {},
    data: {},

    initialize: function(options) {
      var thisRouter = this;
      this.options = options;
      this.app = options.app;

      // Create data object.  We don't use a collection as it makes
      // it much easier to refer to words by the Id
      this.data.words = {};
      _.each(options.words, function(w) {
        thisRouter.data.words[w.id] = new models.Word(w);
      });

      // Create application view
      this.views.application = new views.Application({
        el: this.app.$el,
        template: tApplication,
        data: {
          words: this.data.words,
          storage: this.app.store.enabled
        },
        router: this,
        partials: {
          loading: tLoading,
          word: tWord
        },
        adaptors: [ 'Backbone' ]
      });
    },

    routes: {
      'addressQuiz': 'routeAddressQuiz',
      '*default': 'routeDefault'
    },

    start: function() {
      Backbone.history.start();
    },

    routeDefault: function() {
      this.navigate('/addressQuiz', { trigger: true, replace: true });
    },

    routeAddressQuiz: function() {
      // Handle quiz
    }
  });

  // Return what we have
  return routers;
});

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
    var answers;

    // Remove the store feature the irresponsible way
    this.store.enabled = false;

    // Match up words data with answer data
    if (this.store.enabled) {
      answers = this.getStorage();
      words = _.map(words, function(w) {
        if (answers && answers[w.id]) {
          w.answer = answers[w.id];
        }
        return w;
      });
    }

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
