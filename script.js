const button = document.getElementById('actionButton');
const status = document.getElementById('statusMessage');

if (button && status) {
  button.addEventListener('click', () => {
    status.textContent = 'Your project is ready for the next step.';
  });
}
