# Minnpost Gettysburg Address

A fill in the blank version of the Gettysburg Address.

![Lincoln at Gettysburg](http://upload.wikimedia.org/wikipedia/commons/thumb/f/f2/Lincolns_Gettysburg_Address%2C_Gettysburg.JPG/602px-Lincolns_Gettysburg_Address%2C_Gettysburg.JPG "Lincoln at Gettysburg")

## Data

Gettysburg Address text taken from [abrahamlincolnonline.org](http://www.abrahamlincolnonline.org/lincoln/speeches/gettysburg.htm), cited source of *Collected Works of Abraham Lincoln*, edited by Roy P. Basler.

## Data processing

No data processing was used in this project.  There was manual choosing of words to use for blanks.

## Development and running locally

### Prerequisites

All commands are assumed to on the [command line](http://en.wikipedia.org/wiki/Command-line_interface), often called the Terminal, unless otherwise noted.  The following will install technologies needed for the other steps and will only needed to be run once on your computer so there is a good chance you already have these technologies on your computer.

1. Install [Git](http://git-scm.com/).
   * On a Mac, install [Homebrew](http://brew.sh/), then do: `brew install git`
1. Install [NodeJS](http://nodejs.org/).
   * On a Mac, do: `brew install node`
1. Optionally, for development, install [Grunt](http://gruntjs.com/): `npm install -g grunt-cli`
1. Install [Bower](http://bower.io/): `npm install -g bower`
1. Install [Ruby](http://www.ruby-lang.org/en/downloads/), though it is probably already installed on your system.
1. Install [Bundler](http://gembundler.com/): `gem install bundler`
1. Install [Sass](http://sass-lang.com/): `gem install sass`
   * On a Mac do: `sudo gem install sass`
1. Install [Compass](http://compass-style.org/): `gem install compass`
   * On a Mac do: `sudo gem install compass`

### Get code and install packages

Get the code for this project and install the necessary dependency libraries and packages.

1. Check out this code with [Git](http://git-scm.com/): `git clone https://github.com/MinnPost/minnpost-gettysburg-address.git`
1. Go into the template directory: `cd minnpost-gettysburg-address`
1. Install NodeJS packages: `npm install`
1. Install Bower components: `bower install`

### Running

1. Get pump primed with: `grunt`
1. Run: `grunt server`
    * This will run a local webserver for development and you can view the application in your web browser at [http://localhost:8814](http://localhost:8814).
    * Utilize `index.html` for development, while `index-deploy.html` is used for the deployed version, and `index-build.html` is used to test the build before deployment.
    * The server runs `grunt watch` which will watch for linting JS files and compiling SASS.  If you have your own webserver, feel free to use that with just this command.

### Build

To build or compile all the assets together for easy and efficient deployment, do the following.  It will create all the files in the `dist/` folder.

1. Run: `grunt`

### Deploy

Deploying will push the relevant files up to Amazon's AWS S3 so that they can be easily referenced on the MinnPost site.  This is specific to MinnPost, and your deployment might be different.

1. Run: `grunt deploy`

## Hacks

No hacks used (yet)
