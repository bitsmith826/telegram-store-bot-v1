import 'dotenv/config';

// ===================================== TOKOSHOPP.WEB.ID =======================================
// const createPayment = async (amount, orderId) => {
//     const url = 'https://tokoshopp.web.id/api/payment/create';
    
//     const payload = {
//         amount: amount,
//         order_id: `${orderId}`
//     };

//     try {
//         const response = await fetch(url, {
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/json',
//             'x-api-key': process.env.API_KEY_PG
//         },
//         body: JSON.stringify(payload)
//         });

//         if (!response.ok) {
//             throw new Error(`[ERROR] HTTP error! Status: ${response.status}`);
//         }

//         return await response.json();
//     } catch (error) {
//         console.error('[ERROR] Error creating payment:', error.message);
//     }
// }

// const cancelPayment = async (transactionId) => {
//     const url = 'https://tokoshopp.web.id/cancel-deposit';
    
//     const payload = {
//         transactionId: transactionId
//     };

//     try {
//         const response = await fetch(url, {
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/json',
//             'x-api-key': process.env.API_KEY_PG
//         },
//         body: JSON.stringify(payload)
//         });

//         if (!response.ok) {
//             throw new Error(`[ERROR] HTTP error! Status: ${response.status}`);
//         }

//         return await response.json();
//     } catch (error) {
//         console.error('[ERROR] Error cancel payment:', error.message);
//     }
// };

// const checkPayment = async (transactionId) => {
//     const url = 'https://tokoshopp.web.id/api/payment/status';
    
//     const payload = {
//         transaction_id: transactionId
//     };

//     try {
//         const response = await fetch(url, {
//         method: 'POST',
//         headers: {
//             'Content-Type': 'application/json',
//             'x-api-key': process.env.API_KEY_PG
//         },
//         body: JSON.stringify(payload)
//         });

//         if (!response.ok) {
//             throw new Error(`[ERROR] HTTP error! Status: ${response.status}`);
//         }

//         return await response.json();
//     } catch (error) {
//         console.error('[ERROR] Error check payment:', error.message);
//     }
// };
// ==================================================================================================

// =================================== RAMASHOP.MY.ID (DI-KOMENTARI) ============================
// const buatPayment = async (amount) => {
//     const url = 'https://ramashop.my.id/api/public/deposit/create';
//     
//     const payload = {
//         amount: amount,
//         method: "qris"
//     };
// 
//     try {
//         const response = await fetch(url, {
//             method: 'POST',
//             headers: {
//                 'Content-Type': 'application/json',
//                 'X-API-Key': process.env.API_KEY_PG
//             },
//             body: JSON.stringify(payload)
//         });
// 
//         if (!response.ok) {
//             return null;
//         }
// 
//         return await response.json();
//     } catch (error) {
//         console.error('[ERROR] Error creating payment:', error.message);
//         return null;
//     }
// };
// 
// const cekPayment = async (transactionId) => {
//     const url = `https://ramashop.my.id/api/public/deposit/status/${transactionId}`;
// 
//     try {
//         const response = await fetch(url, {
//             method: 'GET',
//             headers: {
//                 'Content-Type': 'application/json',
//                 'X-API-Key': process.env.API_KEY_PG
//             }
//         });
// 
//         if (!response.ok) {
//             return null;
//         }
// 
//         return await response.json();
//     } catch (err) {
//         console.error('[ERROR] Error check payment:', err.message);
//         return null;
//     }
// };
// ==================================================================================================

// ===================================== NOVAPAY.ID =================================================
const buatPayment = async (amount) => {
    const url = 'https://novpay.id/api/v1/payment/create';

    const payload = {
        amount: Math.round(Number(amount)),
        description: `Order ${process.env.NAMA_TOKO || 'Vhee Store'}`
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.API_KEY_PG}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error('[NOVAPAY CREATE ERROR]', response.status, errBody);
            return null;
        }

        const resJson = await response.json();
        if (!resJson || !resJson.success || !resJson.data) {
            return null;
        }

        const d = resJson.data;

        // Adaptasi ke format standar yang dibaca bot:
        return {
            success: true,
            data: {
                depositId: d.invoice_id,                       // ID Invoice NovaPay
                totalAmount: Number(d.amount_charged || d.amount), // Nominal final yang harus dibayar
                qrString: d.qr_string || d.qr_content,         // String QRIS untuk di-render jadi gambar
                qrImage: d.qr_url,
                checkoutUrl: d.checkout_url || d.payment_url,
                expiredAt: d.expired_at,
                raw: d
            }
        };
    } catch (error) {
        console.error('[ERROR] Error creating payment (NovaPay):', error.message);
        return null;
    }
};

const cekPayment = async (transactionId) => {
    const url = `https://novpay.id/api/v1/payment/status/${transactionId}`;

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.API_KEY_PG}`
            }
        });

        if (!response.ok) {
            return null;
        }

        const resJson = await response.json();
        if (!resJson || !resJson.success || !resJson.data) {
            return null;
        }

        const d = resJson.data;

        // Adaptasi ke format standar yang dibaca bot:
        return {
            success: true,
            data: {
                status: d.status, // "pending" | "success" | "expired" | "failed"
                paidAt: d.paid_at,
                amount: d.amount,
                amountCharged: d.amount_charged,
                raw: d
            }
        };
    } catch (err) {
        console.error('[ERROR] Error check payment (NovaPay):', err.message);
        return null;
    }
};

export { buatPayment, cekPayment };