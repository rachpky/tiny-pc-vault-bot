# Telegram Photocard Shop Bot V3

V3 supports two sale modes in the same bot:

- **First-Come:** adding a card creates an exclusive 10-minute cart hold.
- **Priority:** overlapping claims remain open until a set is allocated; buyers claiming
  more remaining cards are processed before smaller claims.

It also supports photo previews inside the bot and automatic photo listings in a
Telegram sales channel.

## 1. Update Google Apps Script

Open the Photocard Sales Tracker and choose **Extensions → Apps Script**.

Create or replace these four script files with the matching files from this project:

```text
Code.gs
SheetHelpers.gs
Commerce.gs
Priority.gs
```

In **Project Settings → Script Properties**, keep or add:

```text
SHOP_API_SECRET = your long private random secret
```

Select `setupShopApi` and press **Run** once. It adds the integration fields and creates
the new tabs without deleting existing tracker data.

### Inventory fields added

```text
Set ID
Sale Mode
Telegram File ID
Held By
Held Until
Allocated Buyer
Allocated Telegram User ID
Winning Claim ID
```

### Order fields added

```text
Telegram User ID
Order Source
Set ID
```

### Tabs created

```text
Sets
Claims
Claim Items
```

After updating the code, choose **Deploy → Manage deployments → Edit → New version →
Deploy**. Reuse the existing `/exec` URL. Merely saving the script does not update the
live deployment.

## 2. Configure Railway

Replace the old GitHub project files with this V3 project. Keep the existing variables
and add:

```text
ADMIN_TELEGRAM_IDS = your numeric Telegram ID
SALES_CHANNEL_ID = @yourchannelusername
```

Multiple admins can be comma-separated:

```text
ADMIN_TELEGRAM_IDS = 123456789,987654321
```

Send `/whoami` to the bot to obtain your numeric Telegram ID. Add the bot as an admin in
the sales channel and allow it to post messages before using `/postcard`.

The full variable list is in `.env.example`.

## 3. First-come cards

For an ordinary card, leave `Set ID` blank and use either a blank `Sale Mode` or:

```text
First-Come
```

When a buyer adds it to cart, the API atomically changes:

```text
Available → Held → Pending Payment
```

The hold lasts 10 minutes. Another buyer cannot cart the same PC during that period.
Expired holds are released automatically when the bot next reads the inventory.

## 4. Priority sets

Add a row to `Sets`:

| Set ID | Set Name | Claim Opens | Claim Closes | Sale Mode | Status |
|---|---|---|---|---|---|
| SET-001 | Golden Hour San Set | 1 Sep 2026 20:00 | 1 Sep 2026 22:00 | Priority | Claims Open |

For every Inventory card belonging to it, enter:

```text
Set ID = SET-001
Sale Mode = Priority
Status = Available
```

Buyers may overlap on the same PC. Their claim is stored immediately in `Claims` and
`Claim Items`.

After the closing time, run this admin command:

```text
/allocate SET-001
```

The allocation engine repeatedly:

1. counts each buyer’s remaining available cards in that set;
2. selects the largest remaining claim;
3. breaks ties using the earliest final edit time, then Claim ID;
4. awards all currently available cards in that claim;
5. recalculates everyone else’s remaining quantity.

All cards awarded to a buyer are treated as binding purchases. Winners receive a bot
message and choose delivery before the order is created.

If an unpaid priority order is cancelled, the original winner is marked `Forfeited` and
the released cards are automatically reallocated to the remaining claimants.

## 5. Card photo previews

The image is stored by Telegram; the spreadsheet keeps only a reusable File ID.

1. Send the photo to the bot privately.
2. Reply directly to that photo with:

```text
/setphoto SAN-GH2-001
```

The bot writes the image reference into `Telegram File ID`. The preview then appears
whenever a customer opens that card.

To publish the full photo listing to the sales channel:

```text
/postcard SAN-GH2-001
```

The channel post contains:

- the photocard image;
- member, album, version, source and price;
- first-come or priority information;
- current priority claim count;
- a **View / Claim** button that opens the exact card in the bot.

## Customer commands

```text
/start - Open shop
/browse - Browse photocards
/cart - View first-come timed holds
/claims - View priority claims and results
/orders - View orders
/whoami - Show your Telegram User ID
/help - Contact seller
```

## Admin commands

```text
/setphoto CARD-ID - Attach a replied photo to a card
/postcard CARD-ID - Publish a card to the configured sales channel
/allocate SET-ID - Close and allocate a priority set
```

## Security

- Never commit a real `.env` file.
- Never hard-code the bot token or API secret.
- Only IDs in `ADMIN_TELEGRAM_IDS` can run photo, posting and allocation commands.
- The Apps Script lock protects both cart holds and priority allocation from concurrent
  updates.
