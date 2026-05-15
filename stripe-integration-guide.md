# Stripe Connect Integration Guide

This guide covers the step-by-step master test flow for Postman, followed by the implementation guide for your React web frontend.

---

## Part 1: The Postman Master Test Flow

Keep your backend running (`npm run dev`) and your Stripe CLI listening (`stripe listen --forward-to localhost:5000/api/payments/webhook`).

### Step 1: Driver Onboarding
1. **Login as Driver:** `POST /api/auth/login` -> Copy the Driver JWT.
2. **Get Setup Link:** `POST /api/payments/driver/connect` (Auth: Driver JWT). Copy the `url`.
3. **Complete Stripe Setup:** Paste the URL in your browser and complete the fake Stripe onboarding.
4. **Verify Onboarding:** `GET /api/payments/driver/connect/status` (Auth: Driver JWT). Ensure it returns `"onboarded": true`.

### Step 2: Assign Driver to Booking
1. **Login as Customer:** Create a booking (`POST /api/bookings`) and copy the `bookingId`. *(Or just use an existing one)*.
2. **Assign Driver:** `PATCH /api/driver/rides/<bookingId>/assign` (Auth: Driver JWT).

### Step 3: Create Payment Intent (Customer)
1. **Login as Customer:** `POST /api/auth/login` -> Copy the Customer JWT.
2. **Init Payment:** `POST /api/payments/create-payment-intent`
   - **Auth:** Customer JWT
   - **Body:** `{ "bookingId": "<bookingId>" }`
   - **Save:** Copy the `clientSecret`. Also notice the PaymentIntent ID (the part before `_secret_`).

### Step 4: Simulate Frontend Card Payment (Direct to Stripe)
1. **Stripe API Call:** `POST https://api.stripe.com/v1/payment_intents/<PaymentIntent_ID>/confirm`
2. **Auth:** Basic Auth -> Username: `STRIPE_SECRET_KEY` (Leave password blank).
3. **Body (x-www-form-urlencoded):**
   - `payment_method`: `pm_card_visa`
   - `return_url`: `http://localhost:3000/success`
4. **Verify:** Check that the response status is `"succeeded"`.

### Step 5: Confirm on Backend
1. **Confirm Status:** `POST /api/payments/confirm`
   - **Auth:** Customer JWT
   - **Body:** `{ "bookingId": "<bookingId>", "paymentIntentId": "<PaymentIntent_ID>" }`
2. **Done!** The booking is now `paid`.

---

## Part 2: How to Implement in React Web

When you build the React apps, you won't need "Step 4" from above because the Stripe React SDK handles the credit card securely.

### 1. React Driver Dashboard (Onboarding)
*Packages needed: `axios`*

- Create a button: **"Set up Payouts"**.
- When clicked, make an Axios `POST` request to your backend `/api/payments/driver/connect`.
- Use `window.location.href = response.data.url` to redirect the driver to Stripe.
- **Return URL:** Stripe will redirect them back to your app (e.g., `http://localhost:3000/driver/payment/setup`). On that page, use a `useEffect` to call `GET /api/payments/driver/connect/status`. If `"onboarded": true`, show a success message!

### 2. React Customer Checkout (Payment)
*Packages needed: `@stripe/react-stripe-js` and `@stripe/stripe-js`*

#### Step A: Initialize Payment
When the customer lands on the Checkout page, immediately call your backend:

```javascript
// Customer clicks "Proceed to Payment"
const response = await axios.post('/api/payments/create-payment-intent', { bookingId });
const clientSecret = response.data.clientSecret;
// Save this clientSecret in React state
```

#### Step B: Render Stripe Elements
Wrap your checkout form in the Stripe `Elements` provider, passing the `clientSecret`:

```jsx
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';

// Use your PUBLISHABLE key here, not the secret key!
const stripePromise = loadStripe('pk_test_YOUR_PUBLISHABLE_KEY');

function CheckoutWrapper({ clientSecret }) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <CheckoutForm />
    </Elements>
  );
}
```

#### Step C: The Checkout Form
Render the official Stripe card input field, and handle the submit button:

```jsx
function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // This talks directly to Stripe and charges the card! (Replaces Step 4 from Postman)
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: 'http://localhost:3000/payment-success', // Where to go after paying
      },
      redirect: 'if_required' 
    });

    if (error) {
       console.error("Payment failed", error.message);
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
       // Payment worked! Now tell your backend (Replaces Step 5 from Postman)
       await axios.post('/api/payments/confirm', { 
           bookingId: "YOUR_BOOKING_ID", 
           paymentIntentId: paymentIntent.id 
       });
       alert("Payment Successful!");
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement /> {/* This renders the beautiful Stripe card inputs automatically */}
      <button type="submit">Pay Now</button>
    </form>
  );
}
```

That's it! The `@stripe/react-stripe-js` library handles all the PCI compliance, formatting, and security for you.
