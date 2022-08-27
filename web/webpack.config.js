const webpack = require('webpack');
const path = require('path');
const os = require('os');
const nodeExternals = require('webpack-node-externals');

module.exports = {
  entry: {
    'utils-web': {
      filename: 'dist/utils-web.js',
      import: './index.js',
      library: {
        type: 'commonjs',
      }
    },
  },
  externals: [nodeExternals()],
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
  output: {
    path: path.resolve(__dirname),
  },
  plugins: [],
  watch: true,
  // mode: 'development'
  mode: 'production'
};
