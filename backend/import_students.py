import pandas as pd
import psycopg2
from passlib.context import CryptContext
import csv
import secrets
import string

# ── Config ────────────────────────────────────────────────
DB_CONFIG = dict(
    host='127.0.0.1',
    port=5433,
    dbname='rag_db',
    user='rag_user',
    password='rag_password',
    sslmode='disable'
)
EXCEL_PATH = 'C:\\Users\\Nikhil\\Desktop\\datalingo\\list_of_students.xlsx'
OUTPUT_CSV = 'student_imported_users.csv'

pwd = CryptContext(schemes=['bcrypt'], deprecated='auto')

def make_username(email: str) -> str:
    return email.strip().lower()

def make_password(name: str) -> str:
    # Random initial password; share through a secure channel or force reset on first login.
    alphabet = string.ascii_letters + string.digits + "@#$%*_-"
    return "".join(secrets.choice(alphabet) for _ in range(14))

def main():
    sheets = pd.read_excel(EXCEL_PATH, sheet_name=None)
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    credentials = []
    inserted = 0
    skipped = 0

    for batch, df in sheets.items():
        print(f"\nProcessing batch {batch} ({len(df)} students)...")
        for _, row in df.iterrows():
            name = str(row['Name']).strip()
            email = str(row['Email']).strip().lower()

            if not name or not email or email == 'nan':
                continue

            username = make_username(email)
            raw_password = make_password(name)
            hashed = pwd.hash(raw_password)

            try:
                cur.execute("""
                    INSERT INTO users (email, username, hashed_password, role)
                    VALUES (%s, %s, %s, 'student')
                    ON CONFLICT (email) DO NOTHING
                """, (email, username, hashed))

                if cur.rowcount == 1:
                    inserted += 1
                    credentials.append({
                        'batch': batch,
                        'name': name,
                        'email': email,
                        'username': username,
                    })
                    print(f"  ✅ Created: {name} | {username}")
                else:
                    skipped += 1
                    print(f"  ⚠️  Skipped (already exists): {email}")

            except Exception as e:
                print(f"  ❌ Error for {email}: {e}")

    conn.commit()
    cur.close()
    conn.close()

    # Write imported user roster (no plaintext passwords)
    with open(OUTPUT_CSV, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=['batch', 'name', 'email', 'username'])
        writer.writeheader()
        writer.writerows(credentials)

    print(f"\n{'='*50}")
    print(f"✅ Inserted: {inserted}")
    print(f"⚠️  Skipped: {skipped}")
    print(f"📄 Credentials saved to: {OUTPUT_CSV}")

if __name__ == '__main__':
    main()
