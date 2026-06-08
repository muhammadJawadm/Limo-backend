'use strict';

// ─── PATTERNS ─────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// ─── PRIMITIVES ───────────────────────────────────────────────────────────────

const validateEmail = (email) => {
    const v = typeof email === 'string' ? email.trim() : '';
    if (!v) return 'email is required';
    if (!EMAIL_REGEX.test(v)) return 'Invalid email format';
    return null;
};

const validatePhone = (phone) => {
    const v = typeof phone === 'string' ? phone.trim() : '';
    if (!v) return 'phone is required';
    const digits = v.replace(/[\s\-().+]/g, '');
    if (!/^\d{7,15}$/.test(digits)) return 'Invalid phone number — must be 7–15 digits';
    return null;
};

const validatePositiveInt = (value, fieldName) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return `${fieldName} must be a non-negative integer`;
    return null;
};

// ─── SUPPORT ──────────────────────────────────────────────────────────────────

const validateSupportRequest = (payload) => {
    if (!payload.firstName   || !payload.firstName.trim())   return 'firstName is required';
    if (!payload.lastName    || !payload.lastName.trim())    return 'lastName is required';
    const emailErr = validateEmail(payload.email);
    if (emailErr) return emailErr;
    const phoneErr = validatePhone(payload.phone);
    if (phoneErr) return phoneErr;
    if (!payload.description || !payload.description.trim()) return 'description is required';
    if (payload.description.trim().length > 2000) return 'description must be 2000 characters or fewer';
    return null;
};

// ─── BOOKING ──────────────────────────────────────────────────────────────────

const validatePassengerDetails = (raw) => {
    const details   = raw.passengerDetails || {};
    const firstName = raw.passengerFirstName || details.firstName;
    const lastName  = raw.passengerLastName  || details.lastName;
    const email     = raw.passengerEmail     || details.email;
    const phone     = raw.passengerPhone     || details.phone;

    if (!firstName || !String(firstName).trim()) return 'passengerDetails.firstName is required';
    if (!lastName  || !String(lastName).trim())  return 'passengerDetails.lastName is required';
    const emailErr = validateEmail(email);
    if (emailErr) return `passengerDetails.${emailErr}`;
    const phoneErr = validatePhone(phone);
    if (phoneErr) return `passengerDetails.${phoneErr}`;
    return null;
};

const validateBookerDetails = (raw) => {
    const details   = raw.bookerDetails || {};
    const firstName = raw.bookerFirstName || details.firstName;
    const lastName  = raw.bookerLastName  || details.lastName;
    const email     = raw.bookerEmail     || details.email;
    const phone     = raw.bookerPhone     || details.phone;

    if (!firstName || !String(firstName).trim()) return 'bookerDetails.firstName is required';
    if (!lastName  || !String(lastName).trim())  return 'bookerDetails.lastName is required';
    const emailErr = validateEmail(email);
    if (emailErr) return `bookerDetails.${emailErr}`;
    const phoneErr = validatePhone(phone);
    if (phoneErr) return `bookerDetails.${phoneErr}`;
    return null;
};

module.exports = {
    EMAIL_REGEX,
    validateEmail,
    validatePhone,
    validatePositiveInt,
    validateSupportRequest,
    validatePassengerDetails,
    validateBookerDetails,
};
