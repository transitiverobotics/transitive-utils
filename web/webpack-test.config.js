const webpack = require('webpack');
const path = require('path');
const os = require('os');
const startServer = require('./test/server.js');

module.exports = {
  entry: {
    // 'test': {
    //   filename: 'test-dist/bundle.js',
    //   import: './test/index.js'
    // }
    index: './test/index.js'
  },
  module: {
    rules: [{
      test: /\.(js|jsx)$/,
      exclude: /node_modules/,
      loader: 'babel-loader',
      options: {
        presets: [
          '@babel/preset-env',
          '@babel/preset-react'
        ],
        plugins: [
            '@babel/plugin-proposal-class-properties',
            // would enable async/await but also require export/import
            // '@babel/transform-runtime'
        ]
      },
    }, {
      test: /\.css$/i,
      use: [
        { loader: "css-loader" },
      ]
    }, {
      test: /\.(png|jpe?g|gif|svg|eot|ttf|woff|woff2)$/i,
      loader: "url-loader",
      options: {
        limit: 8192,
      },
    }],
  },
  resolve: {
    extensions: ['*', '.js', '.jsx'],
  },
  // output: {
  //   path: path.resolve(__dirname, 'test-dist'),
  // },
  output: {
    filename: '[name].bundle.js',
    path: path.resolve(__dirname, 'test-dist'),
    clean: true,
  },
  devServer: {
    static: path.join(__dirname, 'test-public'),
    port: 8081,
    setupMiddlewares: (middlewares, devServer) => {
      if (!devServer) {
        throw new Error('webpack-dev-server is not defined');
      }

      devServer.app.get('/json1', (_, response) => {
        response.json({msg: 'json1'});
      });

      devServer.app.get('/unauthorized', (_, response) => {
        response.status(401).json({error: 'you are not authorized!'});
      });

      startServer();
      return middlewares;
    },
  },
  plugins: [],
  watch: true,
  mode: 'development'
};
