// LiteSpeed loads the entry file with require(); the application is asynchronous ESM.
module.exports = import("./server.js").catch((error) => {
  console.error("Antlaqh failed to start:", error);
  process.exit(1);
});
