import os
import logging
from decimal import Decimal
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")

MEMBERS = [
    "Hongjoong", "Seonghwa", "Yunho", "Yeosang",
    "San", "Mingi", "Wooyoung", "Jongho", "OT8 / Units"
]

# Demo inventory.
# Later we will replace this with Google Sheets.
PRODUCTS = [
    {
        "id": "SAN-GH2-001",
        "member": "San",
        "album": "Golden Hour Pt.2",
        "type": "Album PC",
        "price": Decimal("8.00"),
        "status": "Available",
    },
    {
        "id": "SAN-GH2-002",
        "member": "San",
        "album": "Golden Hour Pt.2",
        "type": "POB",
        "price": Decimal("12.00"),
        "status": "Available",
    },
    {
        "id": "MINGI-WILL-001",
        "member": "Mingi",
        "album": "THE WORLD EP.FIN : WILL",
        "type": "Album PC",
        "price": Decimal("9.00"),
        "status": "Available",
    },
]

def money(value: Decimal) -> str:
    return f"${value:.2f}"

def home_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🛍 Browse Cards", callback_data="browse")],
        [InlineKeyboardButton("🛒 My Cart", callback_data="cart"),
         InlineKeyboardButton("📦 My Orders", callback_data="orders")],
        [InlineKeyboardButton("💌 Help", callback_data="help")],
    ])

def member_keyboard():
    rows = []
    for i in range(0, len(MEMBERS), 2):
        row = []
        for member in MEMBERS[i:i+2]:
            row.append(
                InlineKeyboardButton(member, callback_data=f"member:{member}")
            )
        rows.append(row)
    rows.append([InlineKeyboardButton("🏠 Home", callback_data="home")])
    return InlineKeyboardMarkup(rows)

def product_keyboard(product_id: str):
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("➕ Add to Cart", callback_data=f"add:{product_id}")],
        [InlineKeyboardButton("⬅️ Back to Members", callback_data="browse")],
        [InlineKeyboardButton("🏠 Home", callback_data="home")],
    ])

def cart_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("✅ Checkout", callback_data="checkout")],
        [InlineKeyboardButton("🛍 Keep Shopping", callback_data="browse")],
        [InlineKeyboardButton("🗑 Clear Cart", callback_data="clearcart")],
        [InlineKeyboardButton("🏠 Home", callback_data="home")],
    ])

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.setdefault("cart", [])
    text = (
        "💿 *Welcome to the Photocard Shop!*\n\n"
        "Browse available photocards, add them to your cart and check out "
        "directly through the bot."
    )
    await update.message.reply_text(
        text,
        reply_markup=home_keyboard(),
        parse_mode="Markdown",
    )

async def show_home(query, context):
    await query.edit_message_text(
        "💿 *Photocard Shop*\n\nWhat would you like to do?",
        reply_markup=home_keyboard(),
        parse_mode="Markdown",
    )

async def show_browse(query, context):
    await query.edit_message_text(
        "🛍 *Browse Photocards*\n\nChoose a member:",
        reply_markup=member_keyboard(),
        parse_mode="Markdown",
    )

async def show_member(query, context, member):
    available = [
        p for p in PRODUCTS
        if p["member"] == member and p["status"] == "Available"
    ]

    if not available:
        await query.edit_message_text(
            f"😢 No available {member} photocards right now.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("⬅️ Back", callback_data="browse")],
                [InlineKeyboardButton("🏠 Home", callback_data="home")],
            ]),
        )
        return

    buttons = []
    for p in available:
        label = f"{p['id']} • {money(p['price'])}"
        buttons.append([InlineKeyboardButton(label, callback_data=f"product:{p['id']}")])

    buttons.append([InlineKeyboardButton("⬅️ Back", callback_data="browse")])
    buttons.append([InlineKeyboardButton("🏠 Home", callback_data="home")])

    await query.edit_message_text(
        f"✨ *{member}*\n\nChoose a photocard:",
        reply_markup=InlineKeyboardMarkup(buttons),
        parse_mode="Markdown",
    )

async def show_product(query, context, product_id):
    product = next((p for p in PRODUCTS if p["id"] == product_id), None)

    if not product:
        await query.edit_message_text("This product could not be found.")
        return

    text = (
        f"🃏 *{product['member']} — {product['album']}*\n\n"
        f"🆔 `{product['id']}`\n"
        f"🏷 {product['type']}\n"
        f"💰 *{money(product['price'])}*\n"
        f"🟢 {product['status']}"
    )

    await query.edit_message_text(
        text,
        reply_markup=product_keyboard(product_id),
        parse_mode="Markdown",
    )

async def add_to_cart(query, context, product_id):
    cart = context.user_data.setdefault("cart", [])

    product = next((p for p in PRODUCTS if p["id"] == product_id), None)
    if not product or product["status"] != "Available":
        await query.answer("This card is no longer available.", show_alert=True)
        return

    if product_id in cart:
        await query.answer("This card is already in your cart.", show_alert=True)
        return

    cart.append(product_id)
    await query.answer("Added to cart! 🛒", show_alert=False)
    await show_cart(query, context)

async def show_cart(query, context):
    cart = context.user_data.setdefault("cart", [])
    products = [p for p in PRODUCTS if p["id"] in cart]

    if not products:
        await query.edit_message_text(
            "🛒 *Your Cart*\n\nYour cart is empty.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🛍 Browse Cards", callback_data="browse")],
                [InlineKeyboardButton("🏠 Home", callback_data="home")],
            ]),
            parse_mode="Markdown",
        )
        return

    subtotal = sum((p["price"] for p in products), Decimal("0"))
    lines = ["🛒 *Your Cart*\n"]
    for p in products:
        lines.append(f"• `{p['id']}` — {money(p['price'])}")
    lines.append(f"\n*Subtotal: {money(subtotal)}*")

    await query.edit_message_text(
        "\n".join(lines),
        reply_markup=cart_keyboard(),
        parse_mode="Markdown",
    )

async def show_checkout(query, context):
    cart = context.user_data.setdefault("cart", [])
    products = [p for p in PRODUCTS if p["id"] in cart]

    if not products:
        await query.answer("Your cart is empty.", show_alert=True)
        return

    subtotal = sum((p["price"] for p in products), Decimal("0"))

    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("📮 Normal Mail +$1.50", callback_data="shipping:normal")],
        [InlineKeyboardButton("📦 Tracked Mail +$3.00", callback_data="shipping:tracked")],
        [InlineKeyboardButton("⬅️ Back to Cart", callback_data="cart")],
    ])

    await query.edit_message_text(
        f"📦 *Checkout*\n\nSubtotal: *{money(subtotal)}*\n\nChoose your delivery method:",
        reply_markup=keyboard,
        parse_mode="Markdown",
    )

async def shipping_selected(query, context, method):
    cart = context.user_data.setdefault("cart", [])
    products = [p for p in PRODUCTS if p["id"] in cart]
    subtotal = sum((p["price"] for p in products), Decimal("0"))

    if method == "normal":
        shipping = Decimal("1.50")
        shipping_label = "Normal Mail"
    else:
        shipping = Decimal("3.00")
        shipping_label = "Tracked Mail"

    total = subtotal + shipping
    context.user_data["shipping"] = method
    context.user_data["checkout_total"] = str(total)

    text = (
        "🧾 *Order Summary*\n\n"
        + "\n".join(f"• `{p['id']}` — {money(p['price'])}" for p in products)
        + f"\n\nSubtotal: {money(subtotal)}"
        + f"\nDelivery: {shipping_label} — {money(shipping)}"
        + f"\n\n*Total: {money(total)}*"
        + "\n\nThis starter version stops here. "
          "Next we will connect Google Sheets, create order IDs, "
          "send PayNow instructions and accept payment screenshots."
    )

    await query.edit_message_text(
        text,
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("⬅️ Back to Cart", callback_data="cart")],
            [InlineKeyboardButton("🏠 Home", callback_data="home")],
        ]),
        parse_mode="Markdown",
    )

async def callback_router(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    if data == "home":
        await show_home(query, context)
    elif data == "browse":
        await show_browse(query, context)
    elif data == "cart":
        await show_cart(query, context)
    elif data == "orders":
        await query.edit_message_text(
            "📦 *My Orders*\n\nOrder history will appear here once Google Sheets is connected.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🏠 Home", callback_data="home")]
            ]),
            parse_mode="Markdown",
        )
    elif data == "help":
        await query.edit_message_text(
            "💌 *Help*\n\nContact the shop admin if you need help with an order.",
            reply_markup=InlineKeyboardMarkup([
                [InlineKeyboardButton("🏠 Home", callback_data="home")]
            ]),
            parse_mode="Markdown",
        )
    elif data.startswith("member:"):
        await show_member(query, context, data.split(":", 1)[1])
    elif data.startswith("product:"):
        await show_product(query, context, data.split(":", 1)[1])
    elif data.startswith("add:"):
        await add_to_cart(query, context, data.split(":", 1)[1])
    elif data == "clearcart":
        context.user_data["cart"] = []
        await show_cart(query, context)
    elif data == "checkout":
        await show_checkout(query, context)
    elif data.startswith("shipping:"):
        await shipping_selected(query, context, data.split(":", 1)[1])

async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    logger.exception("Unhandled exception while processing an update", exc_info=context.error)

def main():
    if not TOKEN:
        raise RuntimeError(
            "TELEGRAM_BOT_TOKEN is missing. Add it as an environment variable "
            "instead of putting your token directly in the code."
        )

    app: Application = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("browse", start))
    app.add_handler(CommandHandler("cart", start))
    app.add_handler(CallbackQueryHandler(callback_router))
    app.add_error_handler(error_handler)

    print("Photocard shop bot is running...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
