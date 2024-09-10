// Listen for messages from the main window
window.addEventListener("message", (event) => {
  if (event.data && event.data.ipAddress) {
    console.log("Received IP address from main window:", event.data.ipAddress);
    document.querySelector("#ipAddress").value = event.data.ipAddress;
    document.querySelector("#dhdToken").value = event.data.dhdToken;
  }
});

document.querySelector("#send").addEventListener("click", () => {
  const ipAddress = document.querySelector("#ipAddress").value;
  const token = document.querySelector("#dhdToken").value;
  console.log("ipAddress:", ipAddress);
  console.log("token:", token);

  // Send the IP address back to the main window
  if (window.opener) {
    window.opener.postMessage({ ipAddress, token }, "*");
  }
});
