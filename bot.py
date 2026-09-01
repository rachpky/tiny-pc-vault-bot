import html
import logging
import os
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, InputMediaPhoto, Update
from telegram.constants import ParseMode
from telegram.error import BadRequest, Forbidden
from telegram.ext import Application, ApplicationBuilder, CallbackQueryHandler, CommandHandler, ContextTypes

from sheets_api import ShopAPI, ShopAPIError

logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
logger = logging.getLogger(__name__)

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
API_URL = os.getenv("SHEETS_API_URL", "").strip()
API_SECRET = os.getenv("SHOP_API_SECRET", "").strip()
SHOP_NAME = os.getenv("SHOP_NAME", "Photocard Shop").strip()
PAYNOW_NAME = os.getenv("PAYNOW_NAME", "").strip()
PAYNOW_NUMBER = os.getenv("PAYNOW_NUMBER", "").strip()
HELP_CONTACT = os.getenv("HELP_CONTACT", "Contact the shop admin for help.").strip()
SALES_CHANNEL_ID = os.getenv("SALES_CHANNEL_ID", "").strip()
ADMIN_IDS = {value.strip() for value in os.getenv("ADMIN_TELEGRAM_IDS", "").split(",") if value.strip()}
SGT = ZoneInfo("Asia/Singapore")

MEMBERS = ["Hongjoong", "Seonghwa", "Yunho", "Yeosang", "San", "Mingi", "Wooyoung", "Jongho", "OT8 / Unit"]
api = ShopAPI(API_URL, API_SECRET)


def esc(value): return html.escape(str(value or ""))
def money(value): return f"${Decimal(str(value or 0)):.2f}"
def is_admin(user_id): return str(user_id) in ADMIN_IDS


def when(value):
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(SGT).strftime("%d %b, %I:%M %p")
    except (ValueError, AttributeError):
        return str(value)


def user_fields(user):
    return {"buyer_name": user.full_name, "username": user.username or "", "telegram_user_id": str(user.id)}


def home_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🛍 Browse Cards", callback_data="browse")],
        [InlineKeyboardButton("🛒 My Cart", callback_data="cart"), InlineKeyboardButton("📋 My Claims", callback_data="claims")],
        [InlineKeyboardButton("📦 My Orders", callback_data="orders")],
        [InlineKeyboardButton("💌 Help", callback_data="help")],
    ])


def member_keyboard():
    rows = []
    for index in range(0, len(MEMBERS), 2):
        rows.append([InlineKeyboardButton(member, callback_data=f"member:{member}") for member in MEMBERS[index:index + 2]])
    rows.append([InlineKeyboardButton("🏠 Home", callback_data="home")])
    return InlineKeyboardMarkup(rows)


def home_only():
    return InlineKeyboardMarkup([[InlineKeyboardButton("🏠 Home", callback_data="home")]])


async def edit_view(query, text, keyboard=None):
    kwargs = {"reply_markup": keyboard, "parse_mode": ParseMode.HTML}
    if query.message.photo:
        await query.edit_message_caption(caption=text, **kwargs)
    else:
        await query.edit_message_text(text, disable_web_page_preview=True, **kwargs)


async def show_error(query, error):
    logger.warning("Shop API error: %s", error)
    await edit_view(query, f"⚠️ <b>Could not complete that action.</b>\n\n{esc(error)}", home_only())


def product_text(product, channel=False):
    lines = [f"🃏 <b>{esc(product['member'])} — {esc(product['album'])}</b>", "", f"🆔 <code>{esc(product['id'])}</code>"]
    if product.get("version"): lines.append(f"💿 {esc(product['version'])}")
    if product.get("type"): lines.append(f"🏷 {esc(product['type'])}")
    if product.get("store"): lines.append(f"🏬 {esc(product['store'])}")
    lines.append(f"💰 <b>{money(product['price'])}</b>")
    if product.get("sale_mode") == "Priority":
        lines += [f"🎯 Priority set: {esc(product.get('set_name') or product.get('set_id'))}",
                  f"👀 Current claims: {product.get('claim_count', 0)}"]
        if product.get("claim_closes"): lines.append(f"⏰ Claims close: {esc(when(product['claim_closes']))}")
        lines.append("Claims are ranked by the number of remaining cards claimed in this set.")
    else:
        lines.append("⏳ Adding to cart holds this card for 10 minutes.")
    if channel: lines.append("\nTap below to view or claim in the bot.")
    return "\n".join(lines)


def product_keyboard(product):
    if product.get("sale_mode") == "Priority" and product.get("status") == "Available" and product.get("claim_open"):
        action = InlineKeyboardButton("🎯 Add to Claim", callback_data=f"claim:{product['id']}")
    elif product.get("sale_mode") != "Priority" and product.get("status") == "Available":
        action = InlineKeyboardButton("🛒 Add to Cart", callback_data=f"add:{product['id']}")
    else:
        action = InlineKeyboardButton("Unavailable", callback_data="browse")
    return InlineKeyboardMarkup([[action], [InlineKeyboardButton("⬅️ Browse", callback_data="browse")], [InlineKeyboardButton("🏠 Home", callback_data="home")]])


async def send_product(message, product):
    text, keyboard = product_text(product), product_keyboard(product)
    if product.get("telegram_file_id"):
        await message.reply_photo(product["telegram_file_id"], caption=text, reply_markup=keyboard, parse_mode=ParseMode.HTML)
    else:
        await message.reply_text(text, reply_markup=keyboard, parse_mode=ParseMode.HTML)


async def show_product(query, card_id):
    try:
        product = await api.get_card(card_id)
    except ShopAPIError as error:
        await show_error(query, error)
        return
    if not product:
        await edit_view(query, "Card not found.", home_only())
        return
    text, keyboard = product_text(product), product_keyboard(product)
    if product.get("telegram_file_id"):
        try:
            if query.message.photo:
                await query.edit_message_media(InputMediaPhoto(product["telegram_file_id"], caption=text, parse_mode=ParseMode.HTML), reply_markup=keyboard)
            else:
                await query.message.reply_photo(product["telegram_file_id"], caption=text, reply_markup=keyboard, parse_mode=ParseMode.HTML)
                try: await query.message.delete()
                except BadRequest: pass
            return
        except BadRequest as error:
            logger.warning("Invalid image for %s: %s", card_id, error)
    await edit_view(query, text, keyboard)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if context.args and context.args[0].startswith("card_"):
        try:
            product = await api.get_card(context.args[0][5:])
            if product:
                await send_product(update.message, product)
                return
        except ShopAPIError:
            pass
    await update.message.reply_text(
        f"💿 <b>Welcome to {esc(SHOP_NAME)}!</b>\n\n"
        "First-come cards receive a timed hold. Priority-set cards enter a claim window and are allocated after it closes.",
        reply_markup=home_keyboard(), parse_mode=ParseMode.HTML,
    )


async def browse_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🛍 <b>Browse Photocards</b>\n\nChoose a member:", reply_markup=member_keyboard(), parse_mode=ParseMode.HTML)


async def shortcut(update, label, callback):
    await update.message.reply_text(label, reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton(label, callback_data=callback)]]))


async def cart_command(update: Update, context: ContextTypes.DEFAULT_TYPE): await shortcut(update, "🛒 My Cart", "cart")
async def claims_command(update: Update, context: ContextTypes.DEFAULT_TYPE): await shortcut(update, "📋 My Claims", "claims")
async def orders_command(update: Update, context: ContextTypes.DEFAULT_TYPE): await shortcut(update, "📦 My Orders", "orders")
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE): await update.message.reply_text(f"💌 {HELP_CONTACT}")
async def whoami_command(update: Update, context: ContextTypes.DEFAULT_TYPE): await update.message.reply_text(f"Your Telegram User ID is: <code>{update.effective_user.id}</code>", parse_mode=ParseMode.HTML)


async def show_home(query): await edit_view(query, f"💿 <b>{esc(SHOP_NAME)}</b>\n\nWhat would you like to do?", home_keyboard())
async def show_browse(query): await edit_view(query, "🛍 <b>Browse Photocards</b>\n\nChoose a member:", member_keyboard())


async def show_member(query, member):
    try: products = await api.list_inventory(member)
    except ShopAPIError as error:
        await show_error(query, error); return
    if not products:
        await edit_view(query, f"😢 No available {esc(member)} photocards right now.", InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ Back", callback_data="browse")]])); return
    buttons = []
    for product in products:
        marker = "🎯" if product.get("sale_mode") == "Priority" else "🛒"
        buttons.append([InlineKeyboardButton(f"{marker} {product['id']} • {money(product['price'])}", callback_data=f"product:{product['id']}")])
    buttons += [[InlineKeyboardButton("⬅️ Back", callback_data="browse")], [InlineKeyboardButton("🏠 Home", callback_data="home")]]
    await edit_view(query, f"✨ <b>{esc(member)}</b>\n\n🎯 Priority claim · 🛒 First-come", InlineKeyboardMarkup(buttons))


async def add_to_cart(query, card_id):
    try: await api.hold_card(card_id, str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    await show_cart(query)


async def show_cart(query):
    try: products = await api.list_holds(str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    if not products:
        await edit_view(query, "🛒 <b>Your Cart</b>\n\nYour cart is empty.", InlineKeyboardMarkup([[InlineKeyboardButton("🛍 Browse", callback_data="browse")], [InlineKeyboardButton("🏠 Home", callback_data="home")]])); return
    subtotal = sum((Decimal(str(p["price"])) for p in products), Decimal("0"))
    lines = ["🛒 <b>Your Cart — timed holds</b>\n"] + [f"• <code>{esc(p['id'])}</code> — {money(p['price'])}\n  held until {esc(when(p['held_until']))}" for p in products]
    lines.append(f"\n<b>Subtotal: {money(subtotal)}</b>")
    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("✅ Checkout", callback_data="checkout")], [InlineKeyboardButton("🗑 Release Cart", callback_data="clearcart")], [InlineKeyboardButton("🏠 Home", callback_data="home")]])
    await edit_view(query, "\n".join(lines), keyboard)


async def clear_cart(query):
    try: await api.release_holds([], str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    await show_cart(query)


def shipping_keyboard(prefix):
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📮 Normal Mail +$1.50", callback_data=f"{prefix}:normal")],
        [InlineKeyboardButton("📦 Tracked Mail +$3.00", callback_data=f"{prefix}:tracked")],
        [InlineKeyboardButton("🤝 Meetup", callback_data=f"{prefix}:meetup")],
    ])


async def show_checkout(query):
    try: products = await api.list_holds(str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    if not products:
        await show_cart(query); return
    subtotal = sum((Decimal(str(p["price"])) for p in products), Decimal("0"))
    await edit_view(query, f"📦 <b>Checkout</b>\n\nSubtotal: <b>{money(subtotal)}</b>\n\nChoose delivery:", shipping_keyboard("cartship"))


async def cart_shipping(query, method):
    try: products = await api.list_holds(str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    options = {"normal": (Decimal("1.50"), "Normal Mail"), "tracked": (Decimal("3.00"), "Tracked Mail"), "meetup": (Decimal("0"), "Meetup")}
    fee, label = options.get(method, options["normal"])
    subtotal = sum((Decimal(str(p["price"])) for p in products), Decimal("0"))
    context_text = "\n".join(f"• <code>{esc(p['id'])}</code> — {money(p['price'])}" for p in products)
    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("✅ Confirm Order", callback_data=f"cartconfirm:{method}")], [InlineKeyboardButton("⬅️ Change Delivery", callback_data="checkout")]])
    await edit_view(query, f"🧾 <b>Order Summary</b>\n\n{context_text}\n\nDelivery: {label} — {money(fee)}\n<b>Total: {money(subtotal + fee)}</b>", keyboard)


def payment_text(order):
    if not PAYNOW_NUMBER:
        return "\n\nThe seller will send payment instructions."
    return (f"\n\n💳 <b>PayNow</b>\nName: {esc(PAYNOW_NAME or 'Seller')}\n"
            f"PayNow: <code>{esc(PAYNOW_NUMBER)}</code>\nReference: <code>{esc(order['order_id'])}</code>\n"
            "Send your payment screenshot to the seller after paying.")


async def confirm_cart_order(query, method):
    try:
        products = await api.list_holds(str(query.from_user.id))
        order = await api.create_order(card_ids=[p["id"] for p in products], shipping_method=method, **user_fields(query.from_user))
    except ShopAPIError as error:
        await show_error(query, error); return
    await edit_view(query, f"✅ <b>Order created!</b>\n\nOrder: <code>{esc(order['order_id'])}</code>\nTotal: <b>{money(order['total'])}</b>{payment_text(order)}", home_only())


async def add_claim(query, card_id):
    try: claim = await api.add_claim_item(card_id=card_id, **user_fields(query.from_user))
    except ShopAPIError as error:
        await show_error(query, error); return
    await edit_view(query, f"🎯 <b>Claim updated</b>\n\nSet: {esc(claim['set_name'] or claim['set_id'])}\nClaim: <code>{esc(claim['claim_id'])}</code>\nQuantity: <b>{claim['quantity']}</b>\n\nAll cards allocated to you are binding purchases.", InlineKeyboardMarkup([[InlineKeyboardButton("📋 View My Claims", callback_data="claims")], [InlineKeyboardButton("🛍 Keep Browsing", callback_data="browse")]]))


async def show_claims(query):
    try: claims = await api.list_claims(str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    if not claims:
        await edit_view(query, "📋 <b>My Claims</b>\n\nYou have no priority claims.", home_only()); return
    lines, buttons, checkout_sets = ["📋 <b>My Claims</b>\n"], [], set()
    for claim in claims[:8]:
        lines.append(f"\n<b>{esc(claim['set_name'] or claim['set_id'])}</b> · <code>{esc(claim['claim_id'])}</code>\nStatus: {esc(claim['status'])}")
        for item in claim["items"]:
            icon = {"Won": "✅", "Lost": "❌", "Pending": "⏳", "Forfeited": "🚫"}.get(item["allocation"], "•")
            lines.append(f"{icon} <code>{esc(item['card_id'])}</code> — {esc(item['allocation'])}")
            if item["allocation"] == "Pending":
                buttons.append([InlineKeyboardButton(f"Remove {item['card_id']}", callback_data=f"unclaim:{claim['claim_id']}:{item['card_id']}")])
            if item["allocation"] == "Won" and claim["set_id"] not in checkout_sets:
                buttons.append([InlineKeyboardButton(f"Checkout {claim['set_name'] or claim['set_id']}", callback_data=f"alloccheckout:{claim['set_id']}")])
                checkout_sets.add(claim["set_id"])
    buttons.append([InlineKeyboardButton("🏠 Home", callback_data="home")])
    await edit_view(query, "\n".join(lines), InlineKeyboardMarkup(buttons))


async def remove_claim(query, claim_id, card_id):
    try: await api.remove_claim_item(claim_id, card_id, str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    await show_claims(query)


async def allocation_checkout(query, set_id):
    try: preview = await api.allocation_preview(set_id, str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    if not preview:
        await edit_view(query, "This allocation has already been checked out or is unavailable.", home_only()); return
    lines = [f"🎉 <b>{esc(preview['set_name'] or preview['set_id'])} allocation</b>\n"] + [f"• <code>{esc(card['card_id'])}</code> — {money(card['price'])}" for card in preview["cards"]]
    lines.append(f"\nSubtotal: <b>{money(preview['subtotal'])}</b>\n\nChoose delivery:")
    await edit_view(query, "\n".join(lines), shipping_keyboard(f"allocship:{set_id}"))


async def allocation_shipping(query, set_id, method):
    try: preview = await api.allocation_preview(set_id, str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    options = {"normal": (Decimal("1.50"), "Normal Mail"), "tracked": (Decimal("3.00"), "Tracked Mail"), "meetup": (Decimal("0"), "Meetup")}
    fee, label = options.get(method, options["normal"])
    lines = ["🧾 <b>Priority Allocation Checkout</b>\n"] + [f"• <code>{esc(card['card_id'])}</code> — {money(card['price'])}" for card in preview["cards"]]
    lines += [f"\nDelivery: {label} — {money(fee)}", f"<b>Total: {money(Decimal(str(preview['subtotal'])) + fee)}</b>"]
    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("✅ Confirm Order", callback_data=f"allocconfirm:{set_id}:{method}")], [InlineKeyboardButton("⬅️ Back", callback_data=f"alloccheckout:{set_id}")]])
    await edit_view(query, "\n".join(lines), keyboard)


async def confirm_allocation_order(query, set_id, method):
    try: order = await api.create_allocation_order(set_id=set_id, shipping_method=method, **user_fields(query.from_user))
    except ShopAPIError as error:
        await show_error(query, error); return
    await edit_view(query, f"✅ <b>Priority order created!</b>\n\nOrder: <code>{esc(order['order_id'])}</code>\nTotal: <b>{money(order['total'])}</b>{payment_text(order)}", home_only())


async def show_orders(query):
    try: orders = await api.list_orders(str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    if not orders:
        await edit_view(query, "📦 <b>My Orders</b>\n\nYou have no orders.", home_only()); return
    lines, buttons = ["📦 <b>My Orders</b>\n"], []
    for order in orders[:10]:
        lines.append(f"• <code>{esc(order['order_id'])}</code> — {money(order['total'])} — {esc(order['order_status'])}")
        if order["order_status"] == "Pending Payment":
            buttons.append([InlineKeyboardButton(f"Cancel {order['order_id']}", callback_data=f"cancel:{order['order_id']}")])
    buttons.append([InlineKeyboardButton("🏠 Home", callback_data="home")])
    await edit_view(query, "\n".join(lines), InlineKeyboardMarkup(buttons))


async def notify_allocations(bot, allocations, set_id):
    for allocation in allocations:
        try:
            await bot.send_message(
                chat_id=allocation["telegram_user_id"],
                text=f"🎉 <b>Priority results are ready!</b>\n\nYou received {len(allocation['card_ids'])} card(s) from <code>{esc(set_id)}</code>. All allocated cards are binding purchases.",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("View allocation", callback_data=f"alloccheckout:{set_id}")]]),
                parse_mode=ParseMode.HTML,
            )
        except (Forbidden, BadRequest) as error:
            logger.warning("Could not notify %s: %s", allocation["telegram_user_id"], error)


async def cancel_order(query, context, order_id):
    try: result = await api.cancel_order(order_id, str(query.from_user.id))
    except ShopAPIError as error:
        await show_error(query, error); return
    if result.get("reallocations"):
        await notify_allocations(context.bot, result["reallocations"], result.get("set_id", "priority set"))
    await edit_view(query, f"Order <code>{esc(order_id)}</code> was cancelled.", home_only())


async def set_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("Admin command only."); return
    if not context.args or not update.message.reply_to_message or not update.message.reply_to_message.photo:
        await update.message.reply_text("Reply to a photo with /setphoto CARD-ID"); return
    try:
        product = await api.set_card_photo(context.args[0], update.message.reply_to_message.photo[-1].file_id)
    except ShopAPIError as error:
        await update.message.reply_text(str(error)); return
    await update.message.reply_text(f"✅ Photo attached to {product['id']}.")


async def post_card(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("Admin command only."); return
    if not context.args or not SALES_CHANNEL_ID:
        await update.message.reply_text("Use /postcard CARD-ID and configure SALES_CHANNEL_ID in Railway."); return
    try: product = await api.get_card(context.args[0])
    except ShopAPIError as error:
        await update.message.reply_text(str(error)); return
    me = await context.bot.get_me()
    url = f"https://t.me/{me.username}?start=card_{product['id']}"
    keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("🛍 View / Claim", url=url)]])
    text = product_text(product, channel=True)
    if product.get("telegram_file_id"):
        await context.bot.send_photo(SALES_CHANNEL_ID, product["telegram_file_id"], caption=text, reply_markup=keyboard, parse_mode=ParseMode.HTML)
    else:
        await context.bot.send_message(SALES_CHANNEL_ID, text, reply_markup=keyboard, parse_mode=ParseMode.HTML)
    await update.message.reply_text(f"✅ {product['id']} posted to the sales channel.")


async def allocate_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("Admin command only."); return
    if not context.args:
        await update.message.reply_text("Use /allocate SET-ID"); return
    try: result = await api.allocate_set(context.args[0])
    except ShopAPIError as error:
        await update.message.reply_text(str(error)); return
    await notify_allocations(context.bot, result["allocations"], result["set_id"])
    awarded = sum(len(item["card_ids"]) for item in result["allocations"])
    await update.message.reply_text(f"✅ {result['set_id']} allocated: {awarded} cards across {len(result['allocations'])} buyers.")


async def callback_router(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    if data == "home": await show_home(query)
    elif data == "browse": await show_browse(query)
    elif data == "cart": await show_cart(query)
    elif data == "claims": await show_claims(query)
    elif data == "orders": await show_orders(query)
    elif data == "help": await edit_view(query, f"💌 <b>Help</b>\n\n{esc(HELP_CONTACT)}", home_only())
    elif data.startswith("member:"): await show_member(query, data.split(":", 1)[1])
    elif data.startswith("product:"): await show_product(query, data.split(":", 1)[1])
    elif data.startswith("add:"): await add_to_cart(query, data.split(":", 1)[1])
    elif data.startswith("claim:"): await add_claim(query, data.split(":", 1)[1])
    elif data == "clearcart": await clear_cart(query)
    elif data == "checkout": await show_checkout(query)
    elif data.startswith("cartship:"): await cart_shipping(query, data.split(":", 1)[1])
    elif data.startswith("cartconfirm:"): await confirm_cart_order(query, data.split(":", 1)[1])
    elif data.startswith("unclaim:"):
        _, claim_id, card_id = data.split(":", 2); await remove_claim(query, claim_id, card_id)
    elif data.startswith("alloccheckout:"): await allocation_checkout(query, data.split(":", 1)[1])
    elif data.startswith("allocship:"):
        _, set_id, method = data.split(":", 2); await allocation_shipping(query, set_id, method)
    elif data.startswith("allocconfirm:"):
        _, set_id, method = data.split(":", 2); await confirm_allocation_order(query, set_id, method)
    elif data.startswith("cancel:"): await cancel_order(query, context, data.split(":", 1)[1])


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE):
    logger.exception("Unhandled exception", exc_info=context.error)


def main():
    required = {"TELEGRAM_BOT_TOKEN": TOKEN, "SHEETS_API_URL": API_URL, "SHOP_API_SECRET": API_SECRET}
    missing = [name for name, value in required.items() if not value]
    if missing: raise RuntimeError("Missing environment variables: " + ", ".join(missing))
    app: Application = ApplicationBuilder().token(TOKEN).build()
    for command, handler in [("start", start), ("browse", browse_command), ("cart", cart_command),
                             ("claims", claims_command), ("orders", orders_command), ("help", help_command),
                             ("whoami", whoami_command),
                             ("setphoto", set_photo), ("postcard", post_card), ("allocate", allocate_command)]:
        app.add_handler(CommandHandler(command, handler))
    app.add_handler(CallbackQueryHandler(callback_router))
    app.add_error_handler(error_handler)
    logger.info("%s bot is running", SHOP_NAME)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
