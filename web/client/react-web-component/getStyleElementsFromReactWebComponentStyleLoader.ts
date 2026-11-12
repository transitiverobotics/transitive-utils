/*
 * An optional library which is conditionally added
 * @returns {[]}
 */
export default () => {
  try {
    return require('react-web-component-style-loader/exports').styleElements;
  } catch (e) {
    return [];
  }
};
