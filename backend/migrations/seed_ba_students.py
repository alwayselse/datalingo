from passlib.context import CryptContext

from app.core.db import get_db_connection, release_db_connection


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


STUDENTS = [
    ("25SSDS170001", "Akash Chander", "25SSDS170001@msruas.ac.in"),
    ("25SSDS170002", "B N Bhavana", "25SSDS170002@msruas.ac.in"),
    ("25SSDS170003", "Chethan H", "25SSDS170003@msruas.ac.in"),
    ("25SSDS170004", "Dilip S", "25SSDS170004@msruas.ac.in"),
    ("25SSDS170005", "Gaurav V Hegde", "25SSDS170005@msruas.ac.in"),
    ("25SSDS170006", "Gurukiran G", "25SSDS170006@msruas.ac.in"),
    ("25SSDS170007", "Harshitha S", "25SSDS170007@msruas.ac.in"),
    ("25SSDS170008", "Hemanth K B", "25SSDS170008@msruas.ac.in"),
    ("25SSDS170009", "Manoj A Patil", "25SSDS170009@msruas.ac.in"),
    ("25SSDS170010", "Ragini H", "25SSDS170010@msruas.ac.in"),
    ("25SSDS170011", "S Nithiesh", "25SSDS170011@msruas.ac.in"),
    ("25SSDS170012", "Saras Kumar", "25SSDS170012@msruas.ac.in"),
    ("25SSDS170013", "Shalagha S Sajeev", "25SSDS170013@msruas.ac.in"),
    ("25SSDS170014", "Shreya Faustina Raj", "25SSDS170014@msruas.ac.in"),
    ("25SSDS170015", "Shubhan Cholin", "25SSDS170015@msruas.ac.in"),
    ("25SSDS170016", "Sree Suseela D", "25SSDS170016@msruas.ac.in"),
    ("25SSDS170017", "Srinivas G D", "25SSDS170017@msruas.ac.in"),
    ("25SSDS170018", "Tvisha Mittal", "25SSDS170018@msruas.ac.in"),
    ("25SSDS170019", "Vani M Joshi", "25SSDS170019@msruas.ac.in"),
    ("25SSDS170020", "Vinay Kumar", "25SSDS170020@msruas.ac.in"),
]


def main():
    conn = get_db_connection()
    inserted = 0
    updated = 0

    try:
        with conn.cursor() as cur:
            for roll_no, full_name, email in STUDENTS:
                username = roll_no.lower().strip()
                email_norm = email.lower().strip()
                password_plain = roll_no.lower().strip()
                hashed_password = pwd_context.hash(password_plain)

                cur.execute(
                    """
                    SELECT id
                    FROM users
                    WHERE email = %s OR username = %s
                    LIMIT 1
                    """,
                    (email_norm, username),
                )
                existing = cur.fetchone()

                if existing:
                    cur.execute(
                        """
                        UPDATE users
                        SET email = %s,
                            username = %s,
                            hashed_password = %s,
                            role = 'student',
                            name = %s,
                            course = 'business_analytics',
                            is_active = TRUE
                        WHERE id = %s
                        """,
                        (email_norm, username, hashed_password, full_name, existing[0]),
                    )
                    updated += 1
                    print(f"Updated student: {roll_no} | {full_name}")
                else:
                    cur.execute(
                        """
                        INSERT INTO users (email, username, hashed_password, role, name, course, is_active)
                        VALUES (%s, %s, %s, 'student', %s, 'business_analytics', TRUE)
                        """,
                        (email_norm, username, hashed_password, full_name),
                    )
                    inserted += 1
                    print(f"Inserted student: {roll_no} | {full_name}")

        conn.commit()
        print(f"Seeding completed. Inserted: {inserted}, Updated: {updated}")
    except Exception:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)


if __name__ == "__main__":
    main()
