document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const rememberCheckbox = document.getElementById('remember');
    const termsCheckbox = document.getElementById('terms');

    // Check if user is already logged in
    const token = localStorage.getItem('authToken');
    if (token) {
        window.location.href = '/';
        return;
    }

    // Login form handler
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = emailInput.value.trim();
            const password = passwordInput.value;
            const remember = rememberCheckbox.checked;

            if (!email || !password) {
                alert('Please fill in all fields');
                return;
            }

            try {
                const response = await fetch('/auth/login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: email,
                        password: password
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    
                    // Store token
                    if (remember) {
                        localStorage.setItem('authToken', result.token);
                        localStorage.setItem('userId', result.user_id);
                    } else {
                        sessionStorage.setItem('authToken', result.token);
                        sessionStorage.setItem('userId', result.user_id);
                    }

                    // Redirect to main page
                    window.location.href = '/';
                } else {
                    const error = await response.json();
                    alert(error.detail || 'Login failed');
                }
            } catch (error) {
                console.error('Login error:', error);
                alert('Login failed. Please try again.');
            }
        });

        // Add loading state to form
        loginForm.addEventListener('submit', function() {
            const submitBtn = loginForm.querySelector('.login-btn');
            submitBtn.textContent = 'Logging in...';
            submitBtn.disabled = true;
        });
    }

    // Signup form handler
    if (signupForm) {
        signupForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = emailInput.value.trim();
            const password = passwordInput.value;
            const confirmPassword = confirmPasswordInput.value;
            const terms = termsCheckbox.checked;

            if (!email || !password || !confirmPassword) {
                alert('Please fill in all fields');
                return;
            }

            if (password !== confirmPassword) {
                alert('Passwords do not match');
                return;
            }

            if (password.length < 6) {
                alert('Password must be at least 6 characters long');
                return;
            }

            if (!terms) {
                alert('Please agree to the Terms of Service');
                return;
            }

            try {
                const response = await fetch('/auth/register', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: email,
                        password: password
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    alert('Account created successfully! Please log in.');
                    window.location.href = '/login';
                } else {
                    const error = await response.json();
                    alert(error.detail || 'Registration failed');
                }
            } catch (error) {
                console.error('Registration error:', error);
                alert('Registration failed. Please try again.');
            }
        });

        // Add loading state to form
        signupForm.addEventListener('submit', function() {
            const submitBtn = signupForm.querySelector('.login-btn');
            submitBtn.textContent = 'Creating Account...';
            submitBtn.disabled = true;
        });
    }
});

// Utility function to get auth token
function getAuthToken() {
    return localStorage.getItem('authToken') || sessionStorage.getItem('authToken') || '';
}

// Utility function to get user ID
function getUserId() {
    return localStorage.getItem('userId') || sessionStorage.getItem('userId') || '';
}

// Logout function
function logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userId');
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('userId');
    window.location.href = '/login';
}
