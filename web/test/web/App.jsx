import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useParams } from
  'react-router-dom';
import _ from 'lodash';

// pages
import pages from './Pages';

const styles = {
  wrapper: {
    display: 'flex',
    height: '100%',
  },
  sidebar: {
    flex: '0 0 auto',
    background: 'lightblue',
    height: '100%',
  },
  body: {
    flex: '12 1 auto',
    height: '100%',
  },
};


export default () => {
  return <Router>
    <div style={styles.wrapper}>

      <div style={styles.sidebar}>
        <Link to="/">Home</Link><br/>
        <h4>Pages</h4>
        {_.map(pages, (Comp, name) =>
          <li key={name}><Link to={`/${name}`}>{name}</Link></li>
        )}
      </div>

      <div style={styles.body}>
        <Routes>
          <Route path="/" element={<div>Click on the left</div>} />
          {_.map(pages, (Comp, name) =>
            <Route path={`/${name}`} key={name} element={<Comp />} />
          )}
        </Routes>
      </div>
    </div>
  </Router>;
};

