import json

from app.core.db import get_db_connection, release_db_connection


BA_TOPICS = [
    ("Business Analytics Frameworks & Decision-Making", "Core business analytics frameworks for structured decision-making.", []),
    ("Customer Data & Analytics Lifecycle", "Customer data foundations and the end-to-end analytics lifecycle.", []),
    ("Data Extraction & Analytics", "Methods to extract, clean, and analyze business data.", []),
    ("Data Visualization & Dashboards", "Designing dashboards and visual narratives for business decisions.", []),
    ("RFM Analysis", "Recency, Frequency, Monetary analysis for customer profiling.", [2, 3]),
    ("Customer Segmentation & CLV", "Segmentation methods and customer lifetime value analytics.", [5]),
    ("Causality in Business Analytics", "Causal thinking for reliable business conclusions.", [1]),
    ("Experimental Design & RCTs", "Designing randomized controlled trials for business experiments.", [7]),
    ("A/B Testing & Hypothesis Testing", "Practical testing frameworks for product and business optimization.", [8]),
    ("Pricing Analytics & Revenue Mgmt", "Pricing strategies and revenue optimization techniques.", [9, 6]),
    ("Price Elasticity & Demand Sensitivity", "Estimating demand response to price changes.", [10]),
    ("Promotion & Offer Optimization", "Optimizing promotional offers and campaign outcomes.", [11, 9]),
    ("Time Series Data & Business Applications", "Time series fundamentals in business use-cases.", [3]),
    ("Trend, Seasonality & Cycles", "Decomposing and interpreting business time series patterns.", [13]),
    ("Forecasting Methods (MA, ES, ARIMA)", "Forecasting approaches including MA, ES, and ARIMA.", [14]),
    ("Customer Retention & Churn Analytics", "Retention modeling and churn risk analysis.", [6, 9]),
    ("Inventory Control & Demand Planning", "Demand planning and inventory optimization methods.", [15]),
    ("Supply Chain Analytics & KPIs", "Supply chain performance measurement and KPI tracking.", [17, 4]),
    ("Text & Sentiment Analysis", "NLP techniques for customer feedback and sentiment insights.", [3]),
    ("Advanced Experimentation & Multivariate Testing", "Beyond A/B testing with multivariate experimentation.", [9]),
    ("Ethics, Bias & Responsible Analytics", "Ethical, fair, and responsible analytics practices.", [1]),
    ("Data Privacy & Governance", "Data governance principles and privacy compliance fundamentals.", [21]),
    ("Capstone Project", "Integrative project applying business analytics across domains.", [6, 12, 15, 16, 18, 19, 20, 22]),
]


def main():
    conn = get_db_connection()
    try:
        with conn.cursor() as cur:
            position_to_name = {}

            for idx, (name, description, _) in enumerate(BA_TOPICS, start=1):
                position_to_name[idx] = name
                cur.execute("SELECT id FROM topics WHERE name = %s", (name,))
                existing = cur.fetchone()

                if existing:
                    print(f"Skipped (exists): {name}")
                    continue

                cur.execute(
                    """
                    INSERT INTO topics (name, description, prerequisites, order_index, course)
                    VALUES (%s, %s, %s::jsonb, %s, %s)
                    """,
                    (name, description, json.dumps([]), idx, "business_analytics"),
                )
                print(f"Inserted topic: {name}")

            all_names = [name for name, _, _ in BA_TOPICS]
            cur.execute(
                "SELECT id, name FROM topics WHERE name = ANY(%s)",
                (all_names,),
            )
            rows = cur.fetchall()
            name_to_id = {name: topic_id for topic_id, name in rows}

            for idx, (name, _description, prereq_positions) in enumerate(BA_TOPICS, start=1):
                topic_id = name_to_id.get(name)
                if topic_id is None:
                    raise RuntimeError(f"Missing topic ID for: {name}")

                prereq_ids = []
                for prereq_position in prereq_positions:
                    prereq_name = position_to_name[prereq_position]
                    prereq_id = name_to_id.get(prereq_name)
                    if prereq_id is None:
                        raise RuntimeError(
                            f"Missing prerequisite ID for: {prereq_name} (topic: {name})"
                        )
                    prereq_ids.append(prereq_id)

                cur.execute(
                    """
                    UPDATE topics
                    SET prerequisites = %s::jsonb,
                        course = %s,
                        order_index = %s
                    WHERE id = %s
                    """,
                    (json.dumps(prereq_ids), "business_analytics", idx, topic_id),
                )

        conn.commit()
        print("Prerequisites linked successfully")
    except Exception:
        conn.rollback()
        raise
    finally:
        release_db_connection(conn)


if __name__ == "__main__":
    main()
